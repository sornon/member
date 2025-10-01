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

function cloneItem(item) {
  return item && typeof item === 'object' ? { ...item } : null;
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
      const item = rawItem && rawItem.itemId && !isDefaultEquipmentId(rawItem.itemId) ? cloneItem(rawItem) : null;
      return { ...slot, item };
    })
    .filter((slot) => {
      if (!slot || !slot.slot) {
        return true;
      }
      return !EXCLUDED_SLOT_KEYS.has(slot.slot);
    });

  const sanitizedInventory = rawInventory
    .filter((item) => item && typeof item === 'object' && item.itemId && !isDefaultEquipmentId(item.itemId))
    .map((item) => cloneItem(item));

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
  const sanitizedCategories = storageCategories
    .map((category) => {
      if (!category || typeof category !== 'object') {
        return null;
      }
      const key = typeof category.key === 'string' ? category.key : '';
      const label = typeof category.label === 'string' ? category.label : '';
      const baseCapacity = Math.max(0, Math.floor(Number(category.baseCapacity != null ? category.baseCapacity : 0)));
      const perUpgrade = Math.max(0, Math.floor(Number(category.perUpgrade != null ? category.perUpgrade : 0)));
      const upgrades = Math.max(0, Math.floor(Number(category.upgrades != null ? category.upgrades : 0)));
      const rawCapacity = Number(category.capacity);
      const capacity = Math.max(0, Math.floor(Number.isFinite(rawCapacity) ? rawCapacity : baseCapacity + perUpgrade * upgrades));
      const items = Array.isArray(category.items)
        ? category.items
            .map((item) => {
              if (!item || typeof item !== 'object') {
                return null;
              }
              if (item.itemId && isDefaultEquipmentId(item.itemId)) {
                return null;
              }
              return cloneItem(item);
            })
            .filter((item) => !!item)
        : [];
      const rawUsed = Number(category.used);
      const used = Math.max(0, Math.floor(Number.isFinite(rawUsed) ? rawUsed : items.length));
      const rawRemaining = Number(category.remaining);
      const remaining = Math.max(0, Math.floor(Number.isFinite(rawRemaining) ? rawRemaining : capacity - used));
      return {
        key,
        label,
        baseCapacity,
        perUpgrade,
        upgrades,
        capacity,
        used,
        remaining,
        items
      };
    })
    .filter((category) => !!category);

  const sanitizedStorage = {};
  if (typeof rawStorage.upgrades === 'number' && Number.isFinite(rawStorage.upgrades)) {
    sanitizedStorage.upgrades = Math.max(0, Math.floor(rawStorage.upgrades));
  } else if (rawStorage.upgrades && typeof rawStorage.upgrades === 'object') {
    const normalizedUpgrades = {};
    Object.keys(rawStorage.upgrades).forEach((key) => {
      const value = Number(rawStorage.upgrades[key]);
      if (Number.isFinite(value)) {
        normalizedUpgrades[key] = Math.max(0, Math.floor(value));
      }
    });
    sanitizedStorage.upgrades = normalizedUpgrades;
  }
  if (typeof rawStorage.upgradeAvailable === 'number' && Number.isFinite(rawStorage.upgradeAvailable)) {
    sanitizedStorage.upgradeAvailable = Math.max(0, Math.floor(rawStorage.upgradeAvailable));
  } else if (rawStorage.upgradeAvailable === null) {
    sanitizedStorage.upgradeAvailable = null;
  }
  if (typeof rawStorage.baseCapacity === 'number' && Number.isFinite(rawStorage.baseCapacity)) {
    sanitizedStorage.baseCapacity = Math.max(0, Math.floor(rawStorage.baseCapacity));
  }
  if (typeof rawStorage.perUpgrade === 'number' && Number.isFinite(rawStorage.perUpgrade)) {
    sanitizedStorage.perUpgrade = Math.max(0, Math.floor(rawStorage.perUpgrade));
  }
  const overview = rawStorage.overview && typeof rawStorage.overview === 'object' ? rawStorage.overview : null;
  if (overview) {
    const baseCapacity = Math.max(0, Math.floor(Number(overview.baseCapacity != null ? overview.baseCapacity : 0)));
    const perUpgrade = Math.max(0, Math.floor(Number(overview.perUpgrade != null ? overview.perUpgrade : 0)));
    const upgrades = Math.max(0, Math.floor(Number(overview.upgrades != null ? overview.upgrades : 0)));
    const capacity = Math.max(0, Math.floor(Number(overview.capacity != null ? overview.capacity : baseCapacity + perUpgrade * upgrades)));
    const used = Math.max(0, Math.floor(Number(overview.used != null ? overview.used : 0)));
    const remaining = Math.max(0, Math.floor(Number(overview.remaining != null ? overview.remaining : capacity - used)));
    const nextCapacity = Math.max(0, Math.floor(Number(overview.nextCapacity != null ? overview.nextCapacity : capacity + perUpgrade)));
    const sanitizedOverview = {
      baseCapacity,
      perUpgrade,
      upgrades,
      capacity,
      used,
      remaining,
      nextCapacity
    };
    if (typeof overview.upgradeAvailable === 'number' && Number.isFinite(overview.upgradeAvailable)) {
      sanitizedOverview.upgradeAvailable = Math.max(0, Math.floor(overview.upgradeAvailable));
    } else if (overview.upgradeAvailable === null) {
      sanitizedOverview.upgradeAvailable = null;
    }
    sanitizedStorage.overview = sanitizedOverview;
  }
  sanitizedStorage.categories = sanitizedCategories;

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
