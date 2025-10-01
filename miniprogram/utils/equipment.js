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
      const items = Array.isArray(category.items)
        ? category.items
            .filter((item) => {
              if (!item || typeof item !== 'object') {
                return false;
              }
              if (item.itemId) {
                return !isDefaultEquipmentId(item.itemId);
              }
              return true;
            })
            .map((item) => cloneItem(item))
        : [];
      const capacity = Math.max(0, Math.floor(Number(category.capacity) || 0));
      const used = Math.max(0, Math.floor(Number(category.used) || items.length));
      const remaining = Math.max(0, Math.floor(Number(category.remaining) || Math.max(capacity - items.length, 0)));
      const upgrades = Math.max(0, Math.floor(Number(category.upgrades) || 0));
      const baseCapacity = Math.max(0, Math.floor(Number(category.baseCapacity) || 0));
      const perUpgrade = Math.max(0, Math.floor(Number(category.perUpgrade) || 0));
      return {
        ...category,
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

  const rawSummary = rawStorage && typeof rawStorage.summary === 'object' ? rawStorage.summary : null;
  let sanitizedSummary = null;
  if (rawSummary) {
    const baseCapacity = Math.max(0, Math.floor(Number(rawSummary.baseCapacity) || 0));
    const perUpgrade = Math.max(0, Math.floor(Number(rawSummary.perUpgrade) || 0));
    const upgrades = Math.max(0, Math.floor(Number(rawSummary.upgrades) || 0));
    const capacity = Math.max(0, Math.floor(Number(rawSummary.capacity) || baseCapacity + perUpgrade * upgrades));
    const used = Math.max(0, Math.floor(Number(rawSummary.used) || 0));
    const remaining = Math.max(0, Math.floor(Number(rawSummary.remaining) || Math.max(capacity - used, 0)));
    const upgradeAvailable =
      typeof rawSummary.upgradeAvailable !== 'undefined'
        ? Math.max(0, Math.floor(Number(rawSummary.upgradeAvailable) || 0))
        : null;
    const upgradeLimit =
      typeof rawSummary.upgradeLimit !== 'undefined'
        ? Math.max(0, Math.floor(Number(rawSummary.upgradeLimit) || 0))
        : null;
    sanitizedSummary = {
      baseCapacity,
      perUpgrade,
      upgrades,
      capacity,
      used,
      remaining
    };
    if (upgradeAvailable !== null) {
      sanitizedSummary.upgradeAvailable = upgradeAvailable;
    }
    if (upgradeLimit !== null) {
      sanitizedSummary.upgradeLimit = upgradeLimit;
    }
  }

  const sanitizedStorage = { categories: sanitizedCategories };
  if (typeof rawStorage.upgrades !== 'undefined') {
    sanitizedStorage.upgrades = Math.max(0, Math.floor(Number(rawStorage.upgrades) || 0));
  }
  if (sanitizedSummary) {
    sanitizedStorage.summary = sanitizedSummary;
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
