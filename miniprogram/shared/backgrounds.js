const { BACKGROUND_IMAGE_BASE_PATH, BACKGROUND_VIDEO_BASE_PATH } = require('./asset-paths.js');

const RAW_BACKGROUNDS = [
  { id: 'realm_refining', realmOrder: 1, realmName: '炼气期', name: '炼气之地' },
  {
    id: 'background_spirit_trial',
    realmOrder: 1,
    realmName: '炼气期',
    name: '灵力测试',
    requiresUnlock: true
  },
  { id: 'realm_foundation', realmOrder: 2, realmName: '筑基期', name: '筑基之地' },
  { id: 'realm_core', realmOrder: 3, realmName: '金丹期', name: '金丹之地' },
  { id: 'realm_nascent', realmOrder: 4, realmName: '元婴期', name: '元婴之地' },
  { id: 'realm_divine', realmOrder: 5, realmName: '化神期', name: '化神之地' },
  { id: 'realm_void', realmOrder: 6, realmName: '炼虚期', name: '炼虚之地' },
  { id: 'realm_unity', realmOrder: 7, realmName: '合体期', name: '合体之地' },
  { id: 'realm_great_vehicle', realmOrder: 8, realmName: '大乘期', name: '大乘之地' },
  { id: 'realm_tribulation', realmOrder: 9, realmName: '渡劫期', name: '渡劫之地' },
  { id: 'realm_ascension', realmOrder: 10, realmName: '飞升期', name: '飞升之地' }
];

function resolveMediaKey(realmOrder) {
  const order = Number(realmOrder);
  if (!Number.isFinite(order) || order <= 0) {
    return '1';
  }
  const normalizedOrder = Math.max(1, Math.floor(order));
  return `${normalizedOrder}`;
}

const BACKGROUNDS = RAW_BACKGROUNDS.map((item) => {
  const mediaKey = resolveMediaKey(item.realmOrder);
  return {
    ...item,
    mediaKey,
    image: `${BACKGROUND_IMAGE_BASE_PATH}/${mediaKey}.jpg`,
    video: `${BACKGROUND_VIDEO_BASE_PATH}/${mediaKey}.mp4`
  };
});

function cloneBackground(background) {
  return background ? { ...background } : null;
}

function listBackgrounds() {
  return BACKGROUNDS.map((background) => cloneBackground(background));
}

function resolveBackgroundById(id) {
  if (typeof id !== 'string') {
    return null;
  }
  const found = BACKGROUNDS.find((background) => background.id === id.trim());
  return cloneBackground(found);
}

function resolveBackgroundByRealmName(realmName) {
  if (typeof realmName !== 'string' || !realmName.trim()) {
    return null;
  }
  const found = BACKGROUNDS.find((background) => background.realmName === realmName.trim());
  return cloneBackground(found);
}

function normalizeBackgroundId(id) {
  if (typeof id !== 'string') {
    return '';
  }
  const trimmed = id.trim();
  return BACKGROUNDS.some((background) => background.id === trimmed) ? trimmed : '';
}

function getDefaultBackgroundId() {
  return BACKGROUNDS[0].id;
}

function isBackgroundUnlocked(id, realmOrder, unlockedBackgrounds = []) {
  const background = BACKGROUNDS.find((item) => item.id === id);
  if (!background) {
    return false;
  }
  if (background.requiresUnlock) {
    const unlockSet = new Set(
      Array.isArray(unlockedBackgrounds) ? unlockedBackgrounds.map((value) => String(value)) : []
    );
    if (!unlockSet.has(background.id)) {
      return false;
    }
  }
  const numericRealmOrder = Number(realmOrder);
  if (!Number.isFinite(numericRealmOrder)) {
    return background.realmOrder <= 1;
  }
  return Math.max(1, Math.floor(numericRealmOrder)) >= background.realmOrder;
}

function resolveHighestUnlockedBackgroundByRealmOrder(realmOrder, unlockedBackgrounds = []) {
  const numericRealmOrder = Number(realmOrder);
  if (!Number.isFinite(numericRealmOrder)) {
    return cloneBackground(BACKGROUNDS[0]);
  }
  const unlockSet = new Set(
    Array.isArray(unlockedBackgrounds) ? unlockedBackgrounds.map((value) => String(value)) : []
  );
  const unlocked = BACKGROUNDS.filter((background) => {
    if (background.requiresUnlock && !unlockSet.has(background.id)) {
      return false;
    }
    return numericRealmOrder >= background.realmOrder;
  });
  const target = unlocked.length ? unlocked[unlocked.length - 1] : BACKGROUNDS[0];
  return cloneBackground(target);
}

module.exports = {
  listBackgrounds,
  resolveBackgroundById,
  resolveBackgroundByRealmName,
  normalizeBackgroundId,
  getDefaultBackgroundId,
  isBackgroundUnlocked,
  resolveHighestUnlockedBackgroundByRealmOrder
};
