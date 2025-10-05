const EQUIPMENT_DEFINITIONS = {
  mortal_weapon_staff: { slot: 'weapon', quality: 'mortal' },
  mortal_chest_robe: { slot: 'chest', quality: 'mortal' },
  mortal_boots_lightstep: { slot: 'boots', quality: 'mortal' },
  mortal_belt_ring: { slot: 'belt', quality: 'mortal' },
  mortal_bracer_echo: { slot: 'bracer', quality: 'mortal' },
  mortal_orb_calm: { slot: 'orb', quality: 'mortal' }
};

const SKILL_DEFINITIONS = {
  spell_burning_burst: { quality: 'linggan', maxLevel: 25 }
};

const STORAGE_CATEGORY_LABELS = {
  consumable: '道具',
  material: '材料',
  quest: '任务'
};

const DEFAULT_STORAGE_META = {
  upgrades: {},
  globalUpgrades: 0,
  baseCapacity: 50,
  perUpgrade: 10,
  upgradeLimit: 50,
  upgradeAvailable: 0
};

const DEFAULT_EQUIPMENT_SLOTS = [
  'weapon',
  'helm',
  'chest',
  'boots',
  'belt',
  'bracer',
  'orb',
  'ring',
  'token',
  'pet',
  'focus',
  'treasure'
];

function normalizeDate(value, fallback = new Date()) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  if (typeof value === 'string' && value) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return fallback;
}

function clone(value) {
  if (!value || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => clone(item));
  }
  const result = {};
  Object.keys(value).forEach((key) => {
    result[key] = clone(value[key]);
  });
  return result;
}

function normalizeAttributes(attributes) {
  const source = attributes && typeof attributes === 'object' ? attributes : {};
  const normalized = { ...source };
  normalized.level = Number.isFinite(normalized.level) ? normalized.level : 1;
  normalized.experience = Number.isFinite(normalized.experience) ? normalized.experience : 0;
  normalized.attributePoints = Number.isFinite(normalized.attributePoints)
    ? normalized.attributePoints
    : 0;
  if (!Number.isFinite(normalized.respecAvailable)) {
    normalized.respecAvailable = 1;
  }
  if (!Number.isFinite(normalized.respecLimit)) {
    normalized.respecLimit = 0;
  }
  if (!Number.isFinite(normalized.respecUsed)) {
    normalized.respecUsed = 0;
  }
  return normalized;
}

function createSlotMap(existing) {
  const source = existing && typeof existing === 'object' ? existing : {};
  const slots = { ...source };
  DEFAULT_EQUIPMENT_SLOTS.forEach((slot) => {
    if (!Object.prototype.hasOwnProperty.call(slots, slot)) {
      slots[slot] = null;
    }
  });
  return slots;
}

function normalizeStorage(storage) {
  const base = storage && typeof storage === 'object' ? clone(storage) : {};
  const categories = Array.isArray(base.categories) ? base.categories : [];
  const categoryMap = new Map();
  categories.forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const key = typeof entry.key === 'string' ? entry.key.trim() : '';
    if (!key) {
      return;
    }
    const label = typeof entry.label === 'string' && entry.label.trim()
      ? entry.label.trim()
      : STORAGE_CATEGORY_LABELS[key] || key;
    const items = Array.isArray(entry.items) ? entry.items.slice() : [];
    categoryMap.set(key, { key, label, items });
  });

  Object.keys(STORAGE_CATEGORY_LABELS).forEach((key) => {
    if (!categoryMap.has(key)) {
      categoryMap.set(key, { key, label: STORAGE_CATEGORY_LABELS[key], items: [] });
    }
  });

  const normalized = {
    ...DEFAULT_STORAGE_META,
    ...base,
    categories: Array.from(categoryMap.values())
  };
  normalized.upgrades = normalized.upgrades && typeof normalized.upgrades === 'object'
    ? { ...normalized.upgrades }
    : { ...DEFAULT_STORAGE_META.upgrades };
  normalized.globalUpgrades = Number.isFinite(normalized.globalUpgrades)
    ? normalized.globalUpgrades
    : DEFAULT_STORAGE_META.globalUpgrades;
  normalized.baseCapacity = Number.isFinite(normalized.baseCapacity)
    ? normalized.baseCapacity
    : DEFAULT_STORAGE_META.baseCapacity;
  normalized.perUpgrade = Number.isFinite(normalized.perUpgrade)
    ? normalized.perUpgrade
    : DEFAULT_STORAGE_META.perUpgrade;
  normalized.upgradeLimit = Number.isFinite(normalized.upgradeLimit)
    ? normalized.upgradeLimit
    : DEFAULT_STORAGE_META.upgradeLimit;
  normalized.upgradeAvailable = Number.isFinite(normalized.upgradeAvailable)
    ? normalized.upgradeAvailable
    : DEFAULT_STORAGE_META.upgradeAvailable;
  return normalized;
}

function normalizeEquipment(equipment) {
  const source = equipment && typeof equipment === 'object' ? equipment : {};
  return {
    ...source,
    inventory: Array.isArray(source.inventory) ? source.inventory.slice() : [],
    slots: createSlotMap(source.slots),
    storage: normalizeStorage(source.storage)
  };
}

function normalizeSkills(skills) {
  const source = skills && typeof skills === 'object' ? skills : {};
  return {
    ...source,
    inventory: Array.isArray(source.inventory) ? source.inventory.slice() : [],
    equipped: Array.isArray(source.equipped) ? source.equipped.slice() : [],
    lastDrawAt: source.lastDrawAt ? normalizeDate(source.lastDrawAt) : null,
    drawCount: Number.isFinite(source.drawCount) ? source.drawCount : 0
  };
}

function normalizeProfile(profile, now = new Date()) {
  const base = profile && typeof profile === 'object' ? profile : {};
  const normalized = {
    ...clone(base),
    attributes: normalizeAttributes(base.attributes),
    equipment: normalizeEquipment(base.equipment, now),
    skills: normalizeSkills(base.skills),
    battleHistory: Array.isArray(base.battleHistory) ? base.battleHistory.slice() : [],
    skillHistory: Array.isArray(base.skillHistory) ? base.skillHistory.slice() : []
  };
  return normalized;
}

function generateInventoryId(prefix, itemId, now) {
  return `${prefix}_${itemId}_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createEquipmentInventoryEntry(itemId, now) {
  const definition = EQUIPMENT_DEFINITIONS[itemId];
  if (!definition) {
    return null;
  }
  return {
    inventoryId: generateInventoryId('eq', itemId, now),
    itemId,
    quality: definition.quality || 'mortal',
    level: 1,
    refine: 0,
    obtainedAt: now,
    favorite: false
  };
}

function ensureEquipmentOwned(profile, itemId, now = new Date()) {
  const definition = EQUIPMENT_DEFINITIONS[itemId];
  if (!definition) {
    return false;
  }
  profile.equipment = normalizeEquipment(profile.equipment);
  const equipment = profile.equipment;
  const existsInSlots = Object.values(equipment.slots || {}).some(
    (entry) => entry && entry.itemId === itemId
  );
  const existsInInventory = Array.isArray(equipment.inventory)
    ? equipment.inventory.some((entry) => entry && entry.itemId === itemId)
    : false;
  if (existsInSlots || existsInInventory) {
    return false;
  }
  const entry = createEquipmentInventoryEntry(itemId, now);
  if (!entry) {
    return false;
  }
  equipment.inventory.push(entry);
  profile.equipment = equipment;
  return true;
}

function createSkillInventoryEntry(skillId, now = new Date()) {
  const definition = SKILL_DEFINITIONS[skillId] || {};
  return {
    skillId,
    quality: definition.quality || 'linggan',
    level: 1,
    duplicates: 0,
    obtainedAt: now,
    favorite: false
  };
}

function ensureSkillOwned(profile, skillId, now = new Date()) {
  const definition = SKILL_DEFINITIONS[skillId];
  if (!definition) {
    return false;
  }
  profile.skills = normalizeSkills(profile.skills);
  const { inventory } = profile.skills;
  const existing = inventory.find((entry) => entry && entry.skillId === skillId);
  if (existing) {
    const maxLevel = Number.isFinite(definition.maxLevel) ? definition.maxLevel : 5;
    existing.level = Math.min(maxLevel, (existing.level || 1) + 1);
    existing.duplicates = (existing.duplicates || 0) + 1;
    existing.obtainedAt = now;
    return true;
  }
  inventory.push(createSkillInventoryEntry(skillId, now));
  return true;
}

function createStorageItemFromGrant(grant = {}, now = new Date()) {
  const id = typeof grant.id === 'string' ? grant.id.trim() : '';
  const name = typeof grant.name === 'string' ? grant.name.trim() : '';
  const description = typeof grant.description === 'string' ? grant.description : '';
  const quantity = Number.isFinite(grant.quantity) && grant.quantity > 0 ? grant.quantity : 1;
  const category = typeof grant.category === 'string' ? grant.category.trim() : 'consumable';
  const type = typeof grant.type === 'string' ? grant.type.trim() : 'consumable';
  return {
    storageCategory: category,
    inventoryId: generateInventoryId('item', id || type, now),
    id,
    type,
    name,
    description,
    quantity,
    obtainedAt: now,
    meta: grant.meta && typeof grant.meta === 'object' ? clone(grant.meta) : {},
    source: grant.source || 'level'
  };
}

function ensureStorageCategory(profile, categoryKey) {
  profile.equipment = normalizeEquipment(profile.equipment);
  const storage = profile.equipment.storage;
  if (!Array.isArray(storage.categories)) {
    storage.categories = [];
  }
  let category = storage.categories.find((entry) => entry && entry.key === categoryKey);
  if (!category) {
    category = {
      key: categoryKey,
      label: STORAGE_CATEGORY_LABELS[categoryKey] || categoryKey,
      items: []
    };
    storage.categories.push(category);
  }
  if (!Array.isArray(category.items)) {
    category.items = [];
  }
  return category;
}

function appendStorageItem(profile, categoryKey, item) {
  if (!item) {
    return false;
  }
  const category = ensureStorageCategory(profile, categoryKey);
  category.items.push(item);
  return true;
}

function applyLevelGrant(profile, grantDefinition = {}, now = new Date()) {
  const timestamp = normalizeDate(now);
  const normalizedProfile = normalizeProfile(profile, timestamp);
  const results = {
    equipmentGranted: [],
    skillsGranted: [],
    itemsGranted: []
  };
  let changed = false;

  if (Array.isArray(grantDefinition.equipment)) {
    grantDefinition.equipment.forEach((itemId) => {
      if (ensureEquipmentOwned(normalizedProfile, itemId, timestamp)) {
        results.equipmentGranted.push(itemId);
        changed = true;
      }
    });
  }

  if (Array.isArray(grantDefinition.skills)) {
    grantDefinition.skills.forEach((skillId) => {
      if (ensureSkillOwned(normalizedProfile, skillId, timestamp)) {
        results.skillsGranted.push(skillId);
        changed = true;
      }
    });
  }

  if (Array.isArray(grantDefinition.items)) {
    grantDefinition.items.forEach((item) => {
      const entry = createStorageItemFromGrant(item, timestamp);
      if (entry && appendStorageItem(normalizedProfile, entry.storageCategory || 'consumable', entry)) {
        results.itemsGranted.push(entry);
        changed = true;
      }
    });
  }

  return { profile: normalizedProfile, changed, results };
}

module.exports = {
  applyLevelGrant,
  normalizeProfile,
  ensureEquipmentOwned,
  ensureSkillOwned,
  createStorageItemFromGrant,
  appendStorageItem
};
