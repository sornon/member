import { buildCloudAssetUrl } from '../shared/asset-paths';

const EQUIPMENT_QUALITY_ORDER = [
  'mortal',
  'inferior',
  'standard',
  'superior',
  'excellent',
  'immortal',
  'perfect',
  'primordial',
  'relic'
];

const EQUIPMENT_QUALITY_RANK_MAP = EQUIPMENT_QUALITY_ORDER.reduce((map, key, index) => {
  map[key] = index + 1;
  return map;
}, {});

const DEFAULT_EQUIPMENT_IDS = [
  'novice_sword',
  'apprentice_helm',
  'apprentice_robe',
  'lightstep_boots',
  'spirit_belt',
  'initiate_bracers',
  'initiate_orb',
  'spirit_ring',
  'oath_token',
  'wooden_puppet',
  'initiate_focus',
  'initiate_treasure'
];

const DEFAULT_EQUIPMENT_ID_SET = new Set(DEFAULT_EQUIPMENT_IDS);

const EXCLUDED_SLOT_KEYS = new Set(['accessory', 'armor']);

const DEFAULT_STORAGE_BASE_CAPACITY = 100;
const DEFAULT_STORAGE_PER_UPGRADE = 20;

const STORAGE_UPGRADE_AVAILABLE_KEYS = ['upgradeAvailable', 'upgradeRemaining', 'availableUpgrades', 'upgradeTokens'];
const STORAGE_UPGRADE_LIMIT_KEYS = ['upgradeLimit', 'maxUpgrades', 'limit'];

function toPositiveInt(value) {
  const number = Number(value);
  if (Number.isFinite(number)) {
    return Math.max(0, Math.floor(number));
  }
  return null;
}

function toOptionalPositiveInt(value) {
  if (value === null) {
    return null;
  }
  const number = Number(value);
  if (Number.isFinite(number)) {
    return Math.max(0, Math.floor(number));
  }
  return null;
}

function sanitizeStorageMeta(meta) {
  if (!meta || typeof meta !== 'object') {
    return null;
  }
  const sanitized = {};
  const assignInt = (key) => {
    if (!Object.prototype.hasOwnProperty.call(meta, key)) {
      return;
    }
    const value = toPositiveInt(meta[key]);
    if (value !== null) {
      sanitized[key] = value;
    }
  };
  const assignOptional = (key) => {
    if (!Object.prototype.hasOwnProperty.call(meta, key)) {
      return;
    }
    if (meta[key] === null) {
      sanitized[key] = null;
      return;
    }
    const value = toPositiveInt(meta[key]);
    if (value !== null) {
      sanitized[key] = value;
    }
  };
  assignInt('baseCapacity');
  assignInt('perUpgrade');
  assignInt('upgrades');
  assignInt('capacity');
  assignInt('used');
  assignInt('remaining');
  assignInt('nextCapacity');
  assignInt('usagePercent');
  assignOptional('upgradeAvailable');
  assignOptional('upgradeLimit');
  assignOptional('upgradesRemaining');
  return Object.keys(sanitized).length ? sanitized : null;
}

function cloneItem(item) {
  return item && typeof item === 'object' ? { ...item } : null;
}

function normalizeBadgeKeyCandidate(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return '';
}

function buildStorageItemBadgeKeys(categoryKey, item, index = 0) {
  const category = normalizeBadgeKeyCandidate(categoryKey) || 'storage';
  if (!item || typeof item !== 'object') {
    const fallbackId = `idx-${index}`;
    return {
      badgeKey: `${category}:${fallbackId}`,
      storageKey: `${category}-${fallbackId}`
    };
  }
  const candidates = [
    item.storageBadgeKey,
    item.storageKey,
    item.inventoryId,
    item.inventoryKey,
    item.storageId,
    item.itemId,
    item.id,
    item._id,
    item.badgeKey,
    item.badgeId,
    item.slot
  ];
  let identifier = '';
  for (let i = 0; i < candidates.length; i += 1) {
    identifier = normalizeBadgeKeyCandidate(candidates[i]);
    if (identifier) {
      break;
    }
  }
  if (!identifier) {
    identifier = `idx-${index}`;
  }
  if (identifier.includes(':')) {
    const parts = identifier.split(':');
    const explicitCategory = normalizeBadgeKeyCandidate(parts[0]);
    const explicitId = normalizeBadgeKeyCandidate(parts.slice(1).join(':'));
    const finalCategory = explicitCategory || category;
    const finalId = explicitId || (explicitCategory ? '' : identifier);
    const resolvedId = finalId || `idx-${index}`;
    return {
      badgeKey: `${finalCategory}:${resolvedId}`,
      storageKey: `${finalCategory}-${resolvedId}`
    };
  }
  return {
    badgeKey: `${category}:${identifier}`,
    storageKey: `${category}-${identifier}`
  };
}

function resolveEquipmentQualityRank(quality) {
  const key = typeof quality === 'string' ? quality : '';
  return EQUIPMENT_QUALITY_RANK_MAP[key] || 1;
}

function resolveStorageMediaKey(item) {
  if (!item || typeof item !== 'object') {
    return '';
  }
  const usageType =
    item.usage && typeof item.usage === 'object' && typeof item.usage.type === 'string'
      ? item.usage.type.trim()
      : '';
  if (!usageType && typeof item.slotLabel === 'string') {
    const slotLabel = item.slotLabel.trim();
    if (slotLabel === '背景') {
      return 'item-1';
    }
    if (slotLabel === '称号') {
      return 'item-2';
    }
  }
  if (usageType === 'unlockBackground' || usageType === 'backgroundUnlock') {
    return 'item-1';
  }
  if (usageType === 'unlockTitle' || usageType === 'titleUnlock') {
    return 'item-2';
  }
  if (usageType === 'skillDraw' || usageType === 'skillUnlock' || usageType === 'unlockSkill') {
    return 'item-3';
  }
  if (usageType === 'grantRight' || usageType === 'grantCoupon' || usageType === 'coupon') {
    return 'item-4';
  }
  const type = typeof item.type === 'string' ? item.type.trim() : '';
  if (type === 'background') {
    return 'item-1';
  }
  if (type === 'title') {
    return 'item-2';
  }
  if (type === 'skill') {
    return 'item-3';
  }
  if (type === 'right' || type === 'voucher' || type === 'coupon') {
    return 'item-4';
  }
  return '';
}

export function buildEquipmentIconPaths(item) {
  if (!item || typeof item !== 'object') {
    return { iconUrl: '', iconFallbackUrl: '' };
  }
  const directMediaKey = typeof item.mediaKey === 'string' ? item.mediaKey.trim() : '';
  const inferredMediaKey = directMediaKey || resolveStorageMediaKey(item);
  if (inferredMediaKey) {
    const fileName = /\.[a-z0-9]+$/i.test(inferredMediaKey) ? inferredMediaKey : `${inferredMediaKey}.png`;
    const mediaUrl = buildCloudAssetUrl('item', fileName);
    return { iconUrl: mediaUrl, iconFallbackUrl: mediaUrl };
  }
  const iconId = toPositiveInt(item.iconId);
  const qualityRank = toPositiveInt(item.qualityRank) || resolveEquipmentQualityRank(item.quality);
  if (!qualityRank) {
    return { iconUrl: '', iconFallbackUrl: '' };
  }
  const fallbackUrl = buildCloudAssetUrl('item', `equip-${qualityRank}.png`);
  const iconUrl = iconId ? buildCloudAssetUrl('item', `equip-${qualityRank}-${iconId}.png`) : fallbackUrl;
  return { iconUrl, iconFallbackUrl: fallbackUrl };
}

function applyEquipmentIcon(item) {
  if (!item || typeof item !== 'object') {
    return item;
  }
  const { iconUrl, iconFallbackUrl } = buildEquipmentIconPaths(item);
  if (iconUrl) {
    item.iconUrl = iconUrl;
  }
  if (iconFallbackUrl) {
    item.iconFallbackUrl = iconFallbackUrl;
  }
  return item;
}

function extractNotesFromSlots(slots) {
  const notes = [];
  (slots || []).forEach((slot) => {
    const item = slot && slot.item;
    if (!item || !Array.isArray(item.notes)) {
      return;
    }
    item.notes.forEach((note) => {
      if (note && !notes.includes(note)) {
        notes.push(note);
      }
    });
  });
  return notes;
}

export function isDefaultEquipmentId(itemId) {
  return typeof itemId === 'string' && DEFAULT_EQUIPMENT_ID_SET.has(itemId);
}

export function sanitizeEquipmentProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    return null;
  }
  const equipment = profile.equipment && typeof profile.equipment === 'object' ? profile.equipment : {};
  const rawSlots = Array.isArray(equipment.slots) ? equipment.slots : [];
  const rawInventory = Array.isArray(equipment.inventory) ? equipment.inventory : [];
  const rawStorage = equipment.storage && typeof equipment.storage === 'object' ? equipment.storage : {};

  const sanitizedSlots = rawSlots
    .map((slot) => {
      if (!slot || typeof slot !== 'object') {
        return { slot: '', slotLabel: '', item: null };
      }
      const rawItem = slot.item && typeof slot.item === 'object' ? slot.item : null;
      const item = rawItem && rawItem.itemId ? cloneItem(rawItem) : null;
      if (item) {
        if (!item.storageCategory) {
          item.storageCategory = 'equipment';
        }
        if (isDefaultEquipmentId(item.itemId)) {
          item.isDefault = true;
        }
        applyEquipmentIcon(item);
      }
      return { ...slot, item };
    })
    .filter((slot) => {
      if (!slot || !slot.slot) {
        return true;
      }
      return !EXCLUDED_SLOT_KEYS.has(slot.slot);
    });

  const sanitizedInventory = rawInventory
    .filter((item) => item && typeof item === 'object' && item.itemId)
    .map((item) => {
      const cloned = cloneItem(item);
      if (!cloned) {
        return null;
      }
      if (!cloned.storageCategory) {
        cloned.storageCategory = 'equipment';
      }
      if (isDefaultEquipmentId(cloned.itemId)) {
        cloned.isDefault = true;
      }
      applyEquipmentIcon(cloned);
      return cloned;
    })
    .filter((item) => !!item);

  const setCounts = {};
  sanitizedSlots.forEach((slot) => {
    const item = slot && slot.item;
    if (item && item.setId) {
      const setId = item.setId;
      setCounts[setId] = (setCounts[setId] || 0) + 1;
    }
  });

  const bonus = equipment.bonus && typeof equipment.bonus === 'object' ? equipment.bonus : {};
  const rawSets = Array.isArray(bonus.sets) ? bonus.sets : [];
  const sanitizedSets = rawSets
    .map((set) => {
      if (!set || typeof set !== 'object') {
        return null;
      }
      const setId = set.setId;
      const count = setId ? setCounts[setId] || 0 : 0;
      if (!count) {
        return null;
      }
      return { ...set, count };
    })
    .filter((set) => !!set);

  const notes = extractNotesFromSlots(sanitizedSlots);

  const storageCategories = Array.isArray(rawStorage.categories) ? rawStorage.categories : [];
  const sanitizedStorageCategories = storageCategories
    .map((category) => {
      if (!category || typeof category !== 'object') {
        return null;
      }
      const key = typeof category.key === 'string' ? category.key : '';
      if (!key) {
        return null;
      }
      const label = typeof category.label === 'string' ? category.label : key;
      const items = Array.isArray(category.items)
        ? category.items
            .filter((item) => item && typeof item === 'object' && item.itemId)
            .map((item, index) => {
              const cloned = cloneItem(item);
              if (!cloned) {
                return null;
              }
              if (!cloned.storageCategory) {
                cloned.storageCategory = key;
              }
              const badgeKeys = buildStorageItemBadgeKeys(key, cloned, index);
              if (!cloned.storageBadgeKey) {
                cloned.storageBadgeKey = badgeKeys.badgeKey;
              }
              if (!cloned.storageKey) {
                cloned.storageKey = badgeKeys.storageKey;
              }
              if (isDefaultEquipmentId(cloned.itemId)) {
                cloned.isDefault = true;
              }
              applyEquipmentIcon(cloned);
              return cloned;
            })
            .filter((item) => !!item)
        : [];
      const baseCapacity = toPositiveInt(category.baseCapacity);
      const perUpgrade = toPositiveInt(category.perUpgrade);
      const upgrades = toPositiveInt(category.upgrades);
      const capacity = toPositiveInt(category.capacity);
      const used = toPositiveInt(category.used);
      const remaining = toPositiveInt(category.remaining);
      const usagePercent = toPositiveInt(category.usagePercent);
      const nextCapacity = toPositiveInt(category.nextCapacity);
      const payload = {
        key,
        label,
        items
      };
      payload.baseCapacity = baseCapacity !== null ? baseCapacity : DEFAULT_STORAGE_BASE_CAPACITY;
      payload.perUpgrade = perUpgrade !== null ? perUpgrade : DEFAULT_STORAGE_PER_UPGRADE;
      payload.upgrades = upgrades !== null ? upgrades : 0;
      payload.capacity = capacity !== null ? capacity : payload.baseCapacity + payload.upgrades * payload.perUpgrade;
      payload.used = used !== null ? used : items.length;
      payload.remaining = remaining !== null ? remaining : Math.max(payload.capacity - payload.used, 0);
      payload.usagePercent = usagePercent !== null
        ? Math.min(100, usagePercent)
        : payload.capacity
        ? Math.min(100, Math.round((payload.used / payload.capacity) * 100))
        : 0;
      payload.nextCapacity = nextCapacity !== null ? nextCapacity : payload.capacity + payload.perUpgrade;
      return payload;
    })
    .filter((category) => !!category);

  const sanitizedStorage = { categories: sanitizedStorageCategories };

  const sanitizedMeta = sanitizeStorageMeta(rawStorage.meta);
  if (sanitizedMeta) {
    sanitizedStorage.meta = sanitizedMeta;
  }

  const baseCapacity = toPositiveInt(rawStorage.baseCapacity);
  sanitizedStorage.baseCapacity = baseCapacity !== null ? baseCapacity : DEFAULT_STORAGE_BASE_CAPACITY;

  const perUpgrade = toPositiveInt(rawStorage.perUpgrade);
  sanitizedStorage.perUpgrade = perUpgrade !== null ? perUpgrade : DEFAULT_STORAGE_PER_UPGRADE;

  const globalUpgrades = toPositiveInt(rawStorage.globalUpgrades);
  sanitizedStorage.globalUpgrades = globalUpgrades !== null ? globalUpgrades : 0;

  if (rawStorage.upgrades && typeof rawStorage.upgrades === 'object') {
    const upgrades = {};
    Object.keys(rawStorage.upgrades).forEach((key) => {
      const value = toPositiveInt(rawStorage.upgrades[key]);
      if (value !== null) {
        upgrades[key] = value;
      }
    });
    if (Object.keys(upgrades).length) {
      sanitizedStorage.upgrades = upgrades;
    }
  }

  for (const key of STORAGE_UPGRADE_AVAILABLE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(rawStorage, key)) {
      const value = toOptionalPositiveInt(rawStorage[key]);
      sanitizedStorage.upgradeAvailable = value;
      break;
    }
  }

  for (const key of STORAGE_UPGRADE_LIMIT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(rawStorage, key)) {
      const value = toOptionalPositiveInt(rawStorage[key]);
      sanitizedStorage.upgradeLimit = value;
      break;
    }
  }

  const sanitizedEquipment = {
    ...equipment,
    slots: sanitizedSlots,
    inventory: sanitizedInventory,
    storage: sanitizedStorage,
    bonus: {
      sets: sanitizedSets,
      notes
    }
  };

  return { ...profile, equipment: sanitizedEquipment };
}

export function getDefaultEquipmentIds() {
  return DEFAULT_EQUIPMENT_IDS.slice();
}

export function getDefaultEquipmentIdSet() {
  return new Set(DEFAULT_EQUIPMENT_IDS);
}
