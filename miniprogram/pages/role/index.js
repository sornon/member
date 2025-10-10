import { PveService, MemberService } from '../../services/api';
import {
  extractPendingAttributePointCountFromProfile,
  writePendingAttributeOverride
} from '../../utils/pending-attributes';
import {
  acknowledgeStorageItems,
  shouldDisplayStorageItemNew,
  syncStorageBadgeStateFromProfile
} from '../../utils/storage-notifications';
import { formatStones } from '../../utils/format';
import { sanitizeEquipmentProfile } from '../../utils/equipment';

const DEFAULT_STORAGE_BASE_CAPACITY = 100;
const DEFAULT_STORAGE_PER_UPGRADE = 20;

function sanitizeCount(value, fallback = 0) {
  const number = Number(value);
  if (Number.isFinite(number)) {
    return Math.max(0, Math.floor(number));
  }
  const fallbackNumber = Number(fallback);
  if (Number.isFinite(fallbackNumber)) {
    return Math.max(0, Math.floor(fallbackNumber));
  }
  return 0;
}

function sanitizeOptionalCount(value) {
  if (value === null) {
    return null;
  }
  const number = Number(value);
  if (Number.isFinite(number)) {
    return Math.max(0, Math.floor(number));
  }
  return null;
}

function syncRolePendingAttributes(profile) {
  const points = extractPendingAttributePointCountFromProfile(profile);
  if (points === null) {
    return;
  }
  writePendingAttributeOverride(points, Date.now());
}

function extractStorageMetaFromProfile(profile) {
  const storage =
    profile &&
    profile.equipment &&
    profile.equipment.storage &&
    typeof profile.equipment.storage === 'object'
      ? profile.equipment.storage
      : {};
  const meta = storage && typeof storage.meta === 'object' ? storage.meta : {};
  const baseCapacitySource = Object.prototype.hasOwnProperty.call(meta, 'baseCapacity')
    ? meta.baseCapacity
    : storage.baseCapacity;
  const perUpgradeSource = Object.prototype.hasOwnProperty.call(meta, 'perUpgrade')
    ? meta.perUpgrade
    : storage.perUpgrade;
  const upgradesSource = Object.prototype.hasOwnProperty.call(meta, 'upgrades')
    ? meta.upgrades
    : storage.globalUpgrades;
  const baseCapacity = sanitizeCount(baseCapacitySource, DEFAULT_STORAGE_BASE_CAPACITY);
  const perUpgrade = sanitizeCount(perUpgradeSource, DEFAULT_STORAGE_PER_UPGRADE);
  const upgrades = sanitizeCount(upgradesSource, 0);
  const capacitySource = Object.prototype.hasOwnProperty.call(meta, 'capacity') ? meta.capacity : null;
  const capacity = sanitizeCount(capacitySource, baseCapacity + perUpgrade * upgrades);
  const nextCapacitySource = Object.prototype.hasOwnProperty.call(meta, 'nextCapacity') ? meta.nextCapacity : null;
  const nextCapacity = sanitizeCount(nextCapacitySource, capacity + perUpgrade);
  let upgradeAvailable = null;
  if (Object.prototype.hasOwnProperty.call(meta, 'upgradeAvailable')) {
    upgradeAvailable = sanitizeOptionalCount(meta.upgradeAvailable);
  } else if (Object.prototype.hasOwnProperty.call(storage, 'upgradeAvailable')) {
    upgradeAvailable = sanitizeOptionalCount(storage.upgradeAvailable);
  }
  let upgradeLimit = null;
  if (Object.prototype.hasOwnProperty.call(meta, 'upgradeLimit')) {
    upgradeLimit = sanitizeOptionalCount(meta.upgradeLimit);
  } else if (Object.prototype.hasOwnProperty.call(storage, 'upgradeLimit')) {
    upgradeLimit = sanitizeOptionalCount(storage.upgradeLimit);
  }
  if (upgradeLimit !== null && upgradeLimit <= 0) {
    upgradeLimit = null;
  }
  let upgradesRemaining = null;
  if (Object.prototype.hasOwnProperty.call(meta, 'upgradesRemaining')) {
    upgradesRemaining = sanitizeOptionalCount(meta.upgradesRemaining);
  }
  if (upgradesRemaining === null && upgradeLimit !== null) {
    upgradesRemaining = Math.max(upgradeLimit - Math.min(upgradeLimit, upgrades), 0);
  }
  return {
    baseCapacity,
    perUpgrade,
    upgrades,
    capacity,
    nextCapacity,
    upgradeAvailable,
    upgradeLimit,
    upgradesRemaining
  };
}

function finalizeStorageMeta(meta, categories) {
  const list = Array.isArray(categories) ? categories : [];
  const summary = { ...meta };
  const firstCategory = list[0] || {};
  summary.baseCapacity = sanitizeCount(
    summary.baseCapacity,
    meta.baseCapacity || firstCategory.baseCapacity || DEFAULT_STORAGE_BASE_CAPACITY
  );
  summary.perUpgrade = sanitizeCount(
    summary.perUpgrade,
    meta.perUpgrade || firstCategory.perUpgrade || DEFAULT_STORAGE_PER_UPGRADE
  );
  summary.upgrades = sanitizeCount(summary.upgrades, meta.upgrades || firstCategory.upgrades || 0);
  const capacityFallback =
    typeof meta.capacity === 'number'
      ? meta.capacity
      : typeof firstCategory.capacity === 'number'
      ? firstCategory.capacity
      : summary.baseCapacity + summary.perUpgrade * summary.upgrades;
  summary.capacity = sanitizeCount(summary.capacity, capacityFallback);
  summary.nextCapacity = sanitizeCount(summary.nextCapacity, summary.capacity + summary.perUpgrade);
  const usedTotal = list.reduce(
    (total, category) => total + (Array.isArray(category.items) ? category.items.length : 0),
    0
  );
  const used = sanitizeCount(summary.used, usedTotal);
  const clampedUsed = summary.capacity ? Math.min(used, summary.capacity) : used;
  summary.used = clampedUsed;
  if (summary.capacity < clampedUsed) {
    summary.capacity = clampedUsed;
  }
  summary.remaining = summary.capacity ? Math.max(summary.capacity - clampedUsed, 0) : 0;
  summary.usagePercent = summary.capacity
    ? Math.min(100, Math.round((clampedUsed / summary.capacity) * 100))
    : 0;
  if (summary.upgradesRemaining === null && summary.upgradeLimit !== null) {
    summary.upgradesRemaining = Math.max(summary.upgradeLimit - Math.min(summary.upgradeLimit, summary.upgrades), 0);
  } else if (typeof summary.upgradesRemaining === 'number') {
    summary.upgradesRemaining = Math.max(0, summary.upgradesRemaining);
  }
  if (summary.upgradeLimit !== null && summary.upgradeLimit <= 0) {
    summary.upgradeLimit = null;
    summary.upgradesRemaining = null;
  }
  return summary;
}

const ALLOCATABLE_KEYS = ['constitution', 'strength', 'spirit', 'root', 'agility', 'insight'];
const STORAGE_CATEGORY_ORDER = ['equipment', 'quest', 'material', 'consumable'];
const STORAGE_CATEGORY_LABELS = {
  equipment: '装备',
  quest: '任务',
  material: '材料',
  consumable: '道具'
};
const STORAGE_DEFAULT_BASE_CAPACITY = 100;
const STORAGE_DEFAULT_PER_UPGRADE = 20;

function buildTooltipLockKey({ source = '', slot = '', inventoryId = '', itemId = '' } = {}) {
  return [source, slot, inventoryId, itemId].join('|');
}

function normalizeSlotValue(slot) {
  if (typeof slot === 'number' && Number.isFinite(slot)) {
    return String(slot);
  }
  if (typeof slot === 'string') {
    return slot.trim();
  }
  return '';
}

function resolveEquipmentCombatPower(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const candidates = [
    item.combatPower,
    item.power,
    item.powerScore,
    item.powerValue,
    item.fightPower,
    item.fighting,
    item.score,
    item.rating
  ];
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = Number(candidates[i]);
    if (Number.isFinite(candidate)) {
      return candidate;
    }
  }
  const stats = item.stats && typeof item.stats === 'object' ? item.stats : null;
  if (stats) {
    const statCandidates = [stats.combatPower, stats.power, stats.powerScore, stats.rating];
    for (let i = 0; i < statCandidates.length; i += 1) {
      const candidate = Number(statCandidates[i]);
      if (Number.isFinite(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function normalizeTooltipMode(mode) {
  return mode === 'delete' ? 'delete' : 'default';
}

function resolveTooltipDeleteState(tooltip) {
  if (!tooltip || tooltip.mode !== 'delete') {
    return { canDelete: false, reason: '' };
  }
  if (!tooltip.inventoryId) {
    return { canDelete: false, reason: '该物品无法删除' };
  }
  if ((tooltip.category || '') === 'quest') {
    return { canDelete: false, reason: '任务道具不可删除' };
  }
  return { canDelete: true, reason: '' };
}

function normalizeSkillId(value) {
  if (value === null || typeof value === 'undefined') {
    return '';
  }
  return String(value);
}

function findEquippedItemFromProfile(profile, slot, excludeItemId = '') {
  const normalizedSlot = normalizeSlotValue(slot);
  if (!normalizedSlot) {
    return null;
  }
  const equipment = profile && profile.equipment ? profile.equipment : null;
  const slots =
    equipment && Array.isArray(equipment.slots)
      ? equipment.slots
      : [];
  const matchedSlot = slots.find((entry) => {
    if (!entry || !entry.item) {
      return false;
    }
    return normalizeSlotValue(entry.slot) === normalizedSlot;
  });
  if (!matchedSlot || !matchedSlot.item) {
    return null;
  }
  if (excludeItemId && matchedSlot.item.itemId === excludeItemId) {
    return null;
  }
  const equippedItem = { ...matchedSlot.item };
  if (!equippedItem.slot) {
    equippedItem.slot = normalizedSlot;
  }
  if (!equippedItem.slotLabel && matchedSlot.slotLabel) {
    equippedItem.slotLabel = matchedSlot.slotLabel;
  }
  return equippedItem;
}

function rebuildTooltipWithProfile(profile, tooltip) {
  if (!tooltip || !tooltip.item) {
    return null;
  }
  const normalizedSlot = normalizeSlotValue(tooltip.slot || tooltip.item.slot || '');
  const equippedItem = findEquippedItemFromProfile(profile, normalizedSlot, tooltip.item.itemId);
  const refreshed = { ...tooltip, item: { ...tooltip.item } };
  if (equippedItem) {
    refreshed.equippedItem = equippedItem;
  } else {
    delete refreshed.equippedItem;
  }
  return refreshed;
}

Page({
  data: {
    loading: true,
    profile: null,
    activeTab: 'character',
    drawing: false,
    skillDrawCredits: 0,
    resetting: false,
    stoneBalance: 0,
    formattedStoneBalance: formatStones(0),
    equipmentTooltip: null,
    skillModal: null,
    storageCategories: [],
    storageMeta: null,
    activeStorageCategory: 'equipment',
    activeStorageCategoryData: null,
    activeStorageCategoryIndex: -1,
    storageUpgrading: false,
    attributeAdjustments: {},
    attributeAllocationTotal: 0,
    attributeAllocationRemaining: 0,
    attributeAllocationEnabled: {}
  },

  applyProfile(profile, extraState = {}, options = {}) {
    this.clearAllAttributeAdjustTimers();
    const sanitizedProfile = sanitizeEquipmentProfile(profile);
    syncRolePendingAttributes(sanitizedProfile);
    syncStorageBadgeStateFromProfile(sanitizedProfile);
    const storageState = this.buildStorageState(sanitizedProfile);
    const previousCredits = Math.max(0, Math.floor(Number((this.data && this.data.skillDrawCredits) || 0)));
    const rawCredits =
      sanitizedProfile &&
      sanitizedProfile.skills &&
      sanitizedProfile.skills.drawCredits !== undefined
        ? sanitizedProfile.skills.drawCredits
        : previousCredits;
    let skillDrawCredits = Math.max(0, Math.floor(Number(rawCredits) || 0));
    if (options && options.preserveSkillDrawCredits && skillDrawCredits > previousCredits) {
      skillDrawCredits = previousCredits;
    }
    const attributes =
      sanitizedProfile && sanitizedProfile.attributes && typeof sanitizedProfile.attributes === 'object'
        ? sanitizedProfile.attributes
        : null;
    const attributePoints = attributes ? Math.max(0, Number(attributes.attributePoints) || 0) : 0;
    const allocationEnabled = {};
    if (attributes && Array.isArray(attributes.attributeList)) {
      attributes.attributeList.forEach((attr) => {
        if (attr && ALLOCATABLE_KEYS.includes(attr.key)) {
          allocationEnabled[attr.key] = true;
        }
      });
    }
    const updates = {
      ...extraState,
      profile: sanitizedProfile,
      ...storageState,
      skillDrawCredits,
      attributeAdjustments: {},
      attributeAllocationTotal: 0,
      attributeAllocationRemaining: attributePoints,
      attributeAllocationEnabled: allocationEnabled
    };
    const tooltip = this.data ? this.data.equipmentTooltip : null;
    if (tooltip && tooltip.item) {
      const itemId = tooltip.item.itemId;
      const inventoryId = tooltip.item.inventoryId || tooltip.inventoryId || '';
      const equipment = sanitizedProfile && sanitizedProfile.equipment;
      const inSlots =
        equipment &&
        Array.isArray(equipment.slots) &&
        equipment.slots.some((slot) => {
          if (!slot || !slot.item) return false;
          if (inventoryId) {
            return slot.item.inventoryId === inventoryId;
          }
          return slot.item.itemId === itemId;
        });
      const inInventory =
        equipment &&
        Array.isArray(equipment.inventory) &&
        equipment.inventory.some((item) => {
          if (!item) return false;
          if (inventoryId) {
            return item.inventoryId === inventoryId;
          }
          return item.itemId === itemId;
        });
      const storage =
        equipment &&
        equipment.storage &&
        typeof equipment.storage === 'object'
          ? equipment.storage
          : {};
      const categories = Array.isArray(storage.categories) ? storage.categories : [];
      const inStorage = categories.some((category) => {
        if (!category || !Array.isArray(category.items)) {
          return false;
        }
        return category.items.some((storageItem) => {
          if (!storageItem) {
            return false;
          }
          if (inventoryId) {
            return storageItem.inventoryId === inventoryId;
          }
          return storageItem.itemId === itemId;
        });
      });
      if (!inSlots && !inInventory && !inStorage) {
        updates.equipmentTooltip = null;
      } else {
        const refreshedTooltip = rebuildTooltipWithProfile(sanitizedProfile, tooltip);
        if (refreshedTooltip) {
          updates.equipmentTooltip = refreshedTooltip;
        }
      }
    }
    const currentSkillModal = this.data ? this.data.skillModal : null;
    if (currentSkillModal) {
      updates.skillModal = this.rebuildSkillModal(sanitizedProfile, currentSkillModal);
    }
    this.setData(updates);
    return sanitizedProfile;
  },

  buildStorageState(profile) {
    const storageMetaBase = extractStorageMetaFromProfile(profile);
    const storageCategories = this.buildStorageCategories(profile, storageMetaBase);
    const storageMeta = finalizeStorageMeta(storageMetaBase, storageCategories);
    const activeKey = this.resolveActiveStorageCategory(storageCategories);
    const activeCategory = storageCategories.find((category) => category.key === activeKey) || null;
    const activeIndex = storageCategories.findIndex((category) => category.key === activeKey);
    return {
      storageCategories,
      storageMeta,
      activeStorageCategory: activeKey,
      activeStorageCategoryData: activeCategory,
      activeStorageCategoryIndex: activeIndex
    };
  },

  resolveActiveStorageCategory(categories) {
    const list = Array.isArray(categories) ? categories : [];
    const current = this.data && this.data.activeStorageCategory;
    if (current && list.some((category) => category.key === current)) {
      return current;
    }
    const defaultCategory = list.find((category) => category.key === 'equipment');
    if (defaultCategory) {
      return defaultCategory.key;
    }
    return list.length ? list[0].key : '';
  },

  buildStorageCategories(profile, storageMeta = null) {
    const storage =
      profile && profile.equipment && profile.equipment.storage && typeof profile.equipment.storage === 'object'
        ? profile.equipment.storage
        : {};
    const categories = Array.isArray(storage.categories) ? storage.categories : [];
    const meta = storageMeta || extractStorageMetaFromProfile(profile);
    const baseCapacity = typeof meta.baseCapacity === 'number' ? meta.baseCapacity : DEFAULT_STORAGE_BASE_CAPACITY;
    const perUpgrade = typeof meta.perUpgrade === 'number' ? meta.perUpgrade : DEFAULT_STORAGE_PER_UPGRADE;
    const upgrades = typeof meta.upgrades === 'number' ? meta.upgrades : 0;
    const capacity = typeof meta.capacity === 'number' ? meta.capacity : baseCapacity + perUpgrade * upgrades;
    const nextCapacity = typeof meta.nextCapacity === 'number' ? meta.nextCapacity : capacity + perUpgrade;
    return categories
      .map((category) => {
        if (!category || typeof category !== 'object') {
          return null;
        }
        const key = typeof category.key === 'string' ? category.key : '';
        const isEquipmentCategory = key === 'equipment';
        if (!key) {
          return null;
        }
        const label = typeof category.label === 'string' ? category.label : key;
        const items = Array.isArray(category.items) ? category.items : [];
        const normalizedItems = items.map((item, index) => {
          const normalized = { ...item };
          if (typeof normalized.storageKey !== 'string' || !normalized.storageKey) {
            const fallbackId =
              item && item.inventoryId
                ? item.inventoryId
                : `${item && item.itemId ? item.itemId : 'item'}-${index}`;
            normalized.storageKey = `${key}-${fallbackId}`;
          }
          if (!normalized.storageCategory) {
            normalized.storageCategory = key;
          }
          if (!normalized.storageCategoryLabel) {
            normalized.storageCategoryLabel =
              STORAGE_CATEGORY_LABELS[normalized.storageCategory] || normalized.storageCategory || '';
          }
          if (!normalized.kind) {
            normalized.kind = isEquipmentCategory ? 'equipment' : 'storage';
          }
          if (Array.isArray(normalized.notes)) {
            normalized.notes = normalized.notes.filter((note) => !!note);
          } else {
            normalized.notes = [];
          }
          const rawActions = Array.isArray(normalized.actions) ? normalized.actions : [];
          const actions = rawActions
            .map((action) => ({
              key: typeof action.key === 'string' ? action.key : '',
              label: typeof action.label === 'string' ? action.label : '',
              primary: !!action.primary
            }))
            .filter((action) => action.key && action.label);
          normalized.actions = actions;
          if (!normalized.primaryAction) {
            normalized.primaryAction = actions.find((action) => action.primary) || actions[0] || null;
          }
          if (!normalized.slotLabel) {
            normalized.slotLabel =
              STORAGE_CATEGORY_LABELS[normalized.storageCategory] || normalized.storageCategory || '道具';
          }
          if (isEquipmentCategory) {
            const slotValue = normalizeSlotValue(normalized.slot);
            if (slotValue) {
              const equippedItem = findEquippedItemFromProfile(profile, slotValue, normalized.itemId);
              const storedPower = resolveEquipmentCombatPower(normalized);
              const equippedPower = resolveEquipmentCombatPower(equippedItem);
              normalized.recommendedUpgrade =
                !!(
                  equippedItem &&
                  storedPower !== null &&
                  equippedPower !== null &&
                  storedPower > equippedPower
                );
            } else {
              normalized.recommendedUpgrade = false;
            }
          } else {
            normalized.recommendedUpgrade = false;
          }
          normalized.showNewBadge = isEquipmentCategory ? false : shouldDisplayStorageItemNew(normalized);
          return normalized;
        });
        const slotCount = Math.max(capacity, normalizedItems.length);
        const slots = normalizedItems.map((item) => ({
          ...item,
          placeholder: false,
          storageCategory: key,
          showNewBadge: item.showNewBadge
        }));
        for (let i = normalizedItems.length; i < slotCount; i += 1) {
          slots.push({ placeholder: true, storageKey: `${key}-placeholder-${i}`, showNewBadge: false });
        }
        const used = Math.min(normalizedItems.length, slotCount);
        const remaining = Math.max(capacity - normalizedItems.length, 0);
        const usagePercent = capacity ? Math.min(100, Math.round((normalizedItems.length / capacity) * 100)) : 0;
        return {
          key,
          label,
          baseCapacity,
          perUpgrade,
          upgrades,
          capacity: slotCount,
          used,
          remaining,
          usagePercent,
          nextCapacity,
          items: normalizedItems,
          slots
        };
      })
      .filter((category) => !!category);
  },

  refreshStorageNewBadges() {
    const categories = Array.isArray(this.data.storageCategories) ? this.data.storageCategories : [];
    const updates = {};
    const activeIndex = Number.isFinite(this.data.activeStorageCategoryIndex)
      ? this.data.activeStorageCategoryIndex
      : -1;
    categories.forEach((category, categoryIndex) => {
      if (!category) {
        return;
      }
      const categoryKey = typeof category.key === 'string' ? category.key : '';
      const isEquipmentCategory = categoryKey === 'equipment';
      const items = Array.isArray(category.items) ? category.items : [];
      if (isEquipmentCategory) {
        items.forEach((item, itemIndex) => {
          if (item && item.showNewBadge) {
            updates[`storageCategories[${categoryIndex}].items[${itemIndex}].showNewBadge`] = false;
            if (categoryIndex === activeIndex) {
              updates[`activeStorageCategoryData.items[${itemIndex}].showNewBadge`] = false;
            }
          }
        });
        const slots = Array.isArray(category.slots) ? category.slots : [];
        slots.forEach((slotItem, slotIndex) => {
          if (!slotItem || slotItem.placeholder || !slotItem.showNewBadge) {
            return;
          }
          updates[`storageCategories[${categoryIndex}].slots[${slotIndex}].showNewBadge`] = false;
          if (categoryIndex === activeIndex) {
            updates[`activeStorageCategoryData.slots[${slotIndex}].showNewBadge`] = false;
          }
        });
        return;
      }
      items.forEach((item, itemIndex) => {
        if (!item) {
          return;
        }
        const desired = shouldDisplayStorageItemNew(item);
        if (item.showNewBadge !== desired) {
          updates[`storageCategories[${categoryIndex}].items[${itemIndex}].showNewBadge`] = desired;
          if (categoryIndex === activeIndex) {
            updates[`activeStorageCategoryData.items[${itemIndex}].showNewBadge`] = desired;
          }
        }
      });
      const slots = Array.isArray(category.slots) ? category.slots : [];
      slots.forEach((slotItem, slotIndex) => {
        if (!slotItem || slotItem.placeholder) {
          return;
        }
        const desired = shouldDisplayStorageItemNew(slotItem);
        if (slotItem.showNewBadge !== desired) {
          updates[`storageCategories[${categoryIndex}].slots[${slotIndex}].showNewBadge`] = desired;
          if (categoryIndex === activeIndex) {
            updates[`activeStorageCategoryData.slots[${slotIndex}].showNewBadge`] = desired;
          }
        }
      });
    });
    const profile = (this.data && this.data.profile) || null;
    const profileStorage =
      profile &&
      profile.equipment &&
      profile.equipment.storage &&
      typeof profile.equipment.storage === 'object'
        ? profile.equipment.storage
        : null;
    if (profileStorage) {
      const profileCategories = Array.isArray(profileStorage.categories) ? profileStorage.categories : [];
      profileCategories.forEach((category, categoryIndex) => {
        if (!category || !Array.isArray(category.items)) {
          return;
        }
        if ((typeof category.key === 'string' ? category.key : '') === 'equipment') {
          category.items.forEach((item, itemIndex) => {
            if (item && item.showNewBadge) {
              updates[`profile.equipment.storage.categories[${categoryIndex}].items[${itemIndex}].showNewBadge`] = false;
            }
          });
          return;
        }
        category.items.forEach((item, itemIndex) => {
          if (!item) {
            return;
          }
          const desired = shouldDisplayStorageItemNew(item);
          if (item.showNewBadge !== desired) {
            updates[`profile.equipment.storage.categories[${categoryIndex}].items[${itemIndex}].showNewBadge`] = desired;
          }
        });
      });
    }
    if (Object.keys(updates).length) {
      this.setData(updates);
    }
  },

  acknowledgeStorageItem(item) {
    if (!item) {
      return;
    }
    const categoryKey = typeof item.storageCategory === 'string' ? item.storageCategory.trim() : '';
    const kind = typeof item.kind === 'string' ? item.kind.trim() : '';
    if (categoryKey === 'equipment' || kind === 'equipment') {
      return;
    }
    acknowledgeStorageItems(item);
    this.refreshStorageNewBadges();
  },

  onLoad(options = {}) {
    this.tooltipLock = null;
    this.attributeAdjustTimers = {};
    this.attributeAdjustTapSuppress = {};
    const initialTab = this.normalizeTab(options.tab);
    if (initialTab) {
      this.setData({ activeTab: initialTab });
    }
  },

  onShow() {
    this.fetchProfile();
    this.refreshStoneBalance();
  },

  onHide() {
    this.clearAllAttributeAdjustTimers();
  },

  onUnload() {
    this.clearAllAttributeAdjustTimers();
  },

  onPullDownRefresh() {
    Promise.all([this.fetchProfile(false), this.refreshStoneBalance()])
      .catch(() => {})
      .finally(() => {
        wx.stopPullDownRefresh();
      });
  },

  async fetchProfile(showLoading = true) {
    if (this.data.loading && !showLoading) {
      showLoading = true;
    }
    if (showLoading) {
      this.setData({ loading: true });
    }
    try {
      const profile = await PveService.profile();
      this.applyProfile(profile, { loading: false });
    } catch (error) {
      console.error('[role] load profile failed', error);
      wx.showToast({ title: error.errMsg || '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
    return null;
  },

  normalizeTab(tab) {
    if (typeof tab !== 'string') {
      return '';
    }
    const value = tab.toLowerCase();
    if (value === 'character' || value === 'role') {
      return 'character';
    }
    if (value === 'equipment' || value === 'equip') {
      return 'equipment';
    }
    if (value === 'storage' || value === 'bag' || value === 'inventory' || value === 'najie') {
      return 'storage';
    }
    if (value === 'skill' || value === 'skills') {
      return 'skill';
    }
    return '';
  },

  handleTabChange(event) {
    const dataset = event && event.currentTarget ? event.currentTarget.dataset : {};
    const target = this.normalizeTab(dataset.tab);
    if (target && target !== this.data.activeTab) {
      this.setData({ activeTab: target });
    }
  },

  async refreshStoneBalance() {
    try {
      const app = typeof getApp === 'function' ? getApp() : null;
      if (app && app.globalData && app.globalData.memberInfo && app.globalData.memberInfo.stoneBalance != null) {
        this.setStoneBalance(app.globalData.memberInfo.stoneBalance);
      }
      const member = await MemberService.getMember();
      if (member && typeof member.stoneBalance !== 'undefined') {
        this.setStoneBalance(member.stoneBalance);
        if (app && app.globalData) {
          app.globalData.memberInfo = { ...(app.globalData.memberInfo || {}), ...member };
        }
      }
    } catch (error) {
      console.error('[role] refresh stone balance failed', error);
    }
  },

  setStoneBalance(balance) {
    const value = Number(balance) || 0;
    this.setData({
      stoneBalance: value,
      formattedStoneBalance: formatStones(value)
    });
  },

  handleOpenStones() {
    wx.navigateTo({ url: '/pages/stones/stones' });
  },

  async handleDrawSkill() {
    if (this.data.drawing) return;
    const credits = Math.max(0, Number(this.data.skillDrawCredits || 0));
    if (!credits) {
      wx.showToast({ title: '抽取次数不足', icon: 'none' });
      return;
    }
    this.setData({ drawing: true });
    try {
      const res = await PveService.drawSkill();
      this.applyProfile(res.profile, { drawing: false });
      if (res.acquiredSkill) {
        wx.showToast({
          title: `${res.acquiredSkill.qualityLabel}·${res.acquiredSkill.name}`,
          icon: 'success'
        });
      } else {
        wx.showToast({ title: '抽卡完成', icon: 'success' });
      }
    } catch (error) {
      console.error('[role] draw skill failed', error);
      wx.showToast({ title: error.errMsg || '抽卡失败', icon: 'none' });
      this.setData({ drawing: false });
    }
  },

  async handleEquipSkill(event) {
    const skillId = event.currentTarget.dataset.skillId;
    if (!skillId) return;
    try {
      const res = await PveService.equipSkill({ skillId });
      this.applyProfile(res.profile, {}, { preserveSkillDrawCredits: true });
      wx.showToast({ title: '已装备', icon: 'success', duration: 1200 });
    } catch (error) {
      const handled = await this.tryResolveSkillSlotFull(skillId, error);
      if (handled) {
        return;
      }
      console.error('[role] equip skill failed', error);
      wx.showToast({ title: error.errMsg || '操作失败', icon: 'none' });
    }
  },

  async handleUnequipSkill(event) {
    const slot = Number(event.currentTarget.dataset.slot);
    if (!Number.isFinite(slot)) return;
    try {
      const res = await PveService.equipSkill({ skillId: '', slot });
      this.applyProfile(res.profile, {}, { preserveSkillDrawCredits: true });
    } catch (error) {
      console.error('[role] unequip skill failed', error);
      wx.showToast({ title: error.errMsg || '操作失败', icon: 'none' });
    }
  },

  handleSkillCardTap(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const source = typeof dataset.source === 'string' ? dataset.source : '';
    const profile = this.data && this.data.profile ? this.data.profile : null;
    if (!profile || !profile.skills) {
      return;
    }
    const skills = Array.isArray(profile.skills.inventory) ? profile.skills.inventory : [];
    const slots = Array.isArray(profile.skills.equipped) ? profile.skills.equipped : [];
    const datasetSkillId = normalizeSkillId(dataset ? dataset.skillId : '');
    const matchSkillId = (candidate, targetId) => {
      if (!candidate || !targetId) return false;
      const candidateId = normalizeSkillId(candidate.skillId);
      return candidateId && candidateId === targetId;
    };
    if (source === 'equipped') {
      const slotIndex = Number(dataset.index);
      const slotNumber = Number(dataset.slot);
      let slotItem = Number.isFinite(slotIndex) ? slots[slotIndex] : null;
      if ((!slotItem || !slotItem.detail) && Number.isFinite(slotNumber)) {
        slotItem = slots.find((entry) => entry && Number(entry.slot) === slotNumber) || null;
      }
      if (slotItem && slotItem.detail) {
        const slotValue = Number(slotItem.slot);
        const normalizedSlot = Number.isFinite(slotValue)
          ? slotValue
          : Number.isFinite(slotNumber)
          ? slotNumber
          : null;
        const slotLabel = Number.isFinite(normalizedSlot) ? `槽位 ${normalizedSlot + 1}` : '';
        this.openSkillModal({
          skill: slotItem.detail,
          source: 'equipped',
          slotIndex: Number.isFinite(slotIndex) ? slotIndex : null,
          slot: normalizedSlot,
          skillId: slotItem.detail.skillId,
          slotLabel
        });
      }
      return;
    }
    if (source === 'inventory') {
      const inventoryIndex = Number(dataset.index);
      let skillItem = Number.isFinite(inventoryIndex) ? skills[inventoryIndex] : null;
      if (!skillItem && datasetSkillId) {
        skillItem = skills.find((item) => matchSkillId(item, datasetSkillId)) || null;
      }
      if (skillItem) {
        this.openSkillModal({
          skill: skillItem,
          source: 'inventory',
          inventoryIndex: Number.isFinite(inventoryIndex) ? inventoryIndex : null,
          skillId: datasetSkillId || normalizeSkillId(skillItem && skillItem.skillId)
        });
      }
    }
  },

  async tryResolveSkillSlotFull(skillId, error) {
    if (!skillId) {
      return false;
    }
    const errorCode = error && (error.code || error.errCode || '');
    const errorMessage = (error && error.errMsg) || '';
    const isSlotFull =
      errorCode === 'SKILL_SLOT_FULL' || errorMessage.indexOf('技能槽位已满') >= 0 || errorMessage.indexOf('最多装备') >= 0;
    if (!isSlotFull) {
      return false;
    }
    const options = this.buildEquippedSkillOptions();
    if (!options.length) {
      return true;
    }
    if (typeof wx.hideToast === 'function') {
      try {
        wx.hideToast();
      } catch (hideError) {
        console.warn('[role] hide toast failed', hideError);
      }
    }
    let tapIndex;
    try {
      tapIndex = await this.showSkillSlotActionSheet(options.map((option) => option.label));
    } catch (sheetError) {
      if (sheetError && typeof sheetError.errMsg === 'string' && sheetError.errMsg.indexOf('cancel') >= 0) {
        return true;
      }
      console.error('[role] choose skill slot failed', sheetError);
      wx.showToast({ title: (sheetError && sheetError.errMsg) || '操作失败', icon: 'none' });
      return true;
    }
    if (!Number.isFinite(tapIndex) || tapIndex < 0 || tapIndex >= options.length) {
      return true;
    }
    const target = options[tapIndex];
    if (!target || !Number.isFinite(target.slot)) {
      return true;
    }
    try {
      const res = await PveService.equipSkill({ skillId, slot: target.slot });
      this.applyProfile(res.profile, {}, { preserveSkillDrawCredits: true });
      this.closeSkillModal();
      wx.showToast({ title: '已替换', icon: 'success', duration: 1200 });
    } catch (replaceError) {
      console.error('[role] replace skill failed', replaceError);
      wx.showToast({ title: replaceError.errMsg || '操作失败', icon: 'none' });
    }
    return true;
  },

  buildEquippedSkillOptions() {
    const profile = (this.data && this.data.profile) || null;
    if (!profile || !profile.skills) {
      return [];
    }
    const slots = Array.isArray(profile.skills.equipped) ? profile.skills.equipped : [];
    const inventory = Array.isArray(profile.skills.inventory) ? profile.skills.inventory : [];
    const inventoryMap = inventory.reduce((acc, item) => {
      if (!item) {
        return acc;
      }
      const id = normalizeSkillId(item.skillId);
      if (id) {
        acc[id] = item;
      }
      return acc;
    }, {});
    return slots
      .map((entry, index) => {
        if (!entry) {
          return null;
        }
        const slotIndex = Number.isFinite(entry.slot) ? entry.slot : index;
        const id = normalizeSkillId(entry.skillId);
        if (!id) {
          return null;
        }
        const detail = entry.detail || inventoryMap[id] || null;
        const name = detail && detail.name ? detail.name : id;
        const label = `槽位 ${slotIndex + 1} · ${name}`;
        return { slot: slotIndex, skillId: id, label };
      })
      .filter((item) => !!item);
  },

  showSkillSlotActionSheet(itemList = []) {
    return new Promise((resolve, reject) => {
      if (!itemList.length) {
        resolve(null);
        return;
      }
      wx.showActionSheet({
        itemList,
        success: (res) => resolve(res.tapIndex),
        fail: (err) => reject(err)
      });
    });
  },

  openSkillModal(options = {}) {
    const skill = options && options.skill ? options.skill : null;
    if (!skill) {
      return;
    }
    const slotValue = Number(options.slot);
    const slot = Number.isFinite(slotValue) ? slotValue : null;
    const slotIndexValue = Number(options.slotIndex);
    const slotIndex = Number.isFinite(slotIndexValue) ? slotIndexValue : null;
    const inventoryIndexValue = Number(options.inventoryIndex);
    const inventoryIndex = Number.isFinite(inventoryIndexValue) ? inventoryIndexValue : null;
    const skillIdSource = Object.prototype.hasOwnProperty.call(options, 'skillId')
      ? options.skillId
      : skill.skillId;
    const skillId = normalizeSkillId(skillIdSource);
    const modal = {
      visible: true,
      source: typeof options.source === 'string' ? options.source : '',
      slot,
      slotIndex,
      inventoryIndex,
      skillId,
      slotLabel:
        typeof options.slotLabel === 'string' && options.slotLabel
          ? options.slotLabel
          : slot !== null
          ? `槽位 ${slot + 1}`
          : '',
      skill: { ...skill }
    };
    this.setData({ skillModal: modal });
  },

  closeSkillModal() {
    this.setData({ skillModal: null });
  },

  rebuildSkillModal(profile, modal) {
    if (!modal || !modal.visible) {
      return modal;
    }
    const skill = this.resolveSkillModalSkill(profile, modal);
    if (!skill) {
      return null;
    }
    const slotValue = Number(modal.slot);
    const slot = Number.isFinite(slotValue) ? slotValue : null;
    const rebuilt = {
      ...modal,
      slot,
      slotLabel:
        typeof modal.slotLabel === 'string' && modal.slotLabel
          ? modal.slotLabel
          : slot !== null
          ? `槽位 ${slot + 1}`
          : '',
      skill
    };
    return rebuilt;
  },

  resolveSkillModalSkill(profile, modal) {
    if (!profile || !profile.skills) {
      return null;
    }
    const slots = Array.isArray(profile.skills.equipped) ? profile.skills.equipped : [];
    const inventory = Array.isArray(profile.skills.inventory) ? profile.skills.inventory : [];
    if (modal.source === 'equipped') {
      const slotIndexValue = Number(modal.slotIndex);
      const slotIndex = Number.isFinite(slotIndexValue) ? slotIndexValue : null;
      if (slotIndex !== null && slots[slotIndex] && slots[slotIndex].detail) {
        return { ...slots[slotIndex].detail };
      }
      const slotNumberValue = Number(modal.slot);
      const slotNumber = Number.isFinite(slotNumberValue) ? slotNumberValue : null;
      if (slotNumber !== null) {
        const slotItem = slots.find((entry) => entry && Number(entry.slot) === slotNumber);
        if (slotItem && slotItem.detail) {
          return { ...slotItem.detail };
        }
      }
    } else if (modal.source === 'inventory') {
      const inventoryIndexValue = Number(modal.inventoryIndex);
      const inventoryIndex = Number.isFinite(inventoryIndexValue) ? inventoryIndexValue : null;
      if (inventoryIndex !== null && inventory[inventoryIndex]) {
        return { ...inventory[inventoryIndex] };
      }
    }
    const skillId = normalizeSkillId(
      Object.prototype.hasOwnProperty.call(modal, 'skillId') ? modal.skillId : modal.skill && modal.skill.skillId
    );
    if (skillId) {
      const matchInventory = inventory.find((item) => normalizeSkillId(item && item.skillId) === skillId);
      if (matchInventory) {
        return { ...matchInventory };
      }
      const matchSlot = slots
        .map((entry) => (entry && entry.detail ? entry.detail : null))
        .find((detail) => normalizeSkillId(detail && detail.skillId) === skillId);
      if (matchSlot) {
        return { ...matchSlot };
      }
    }
    return null;
  },

  async handleEquipItem(options = {}) {
    const dataset =
      (options && options.currentTarget && options.currentTarget.dataset) ||
      (options && typeof options === 'object' ? options : {}) || {};
    const itemId = typeof dataset.itemId === 'string' ? dataset.itemId : '';
    const slot = typeof dataset.slot === 'string' ? dataset.slot.trim() : '';
    const inventoryId = typeof dataset.inventoryId === 'string' ? dataset.inventoryId : '';
    if (!itemId) return false;
    try {
      const res = await PveService.equipItem({ itemId, slot, inventoryId });
      this.applyProfile(res.profile);
      wx.showToast({ title: '装备成功', icon: 'success', duration: 1200 });
      return true;
    } catch (error) {
      console.error('[role] equip item failed', error);
      wx.showToast({ title: error.errMsg || '操作失败', icon: 'none' });
      return false;
    }
  },

  async handleUnequipItem(options = {}) {
    const dataset =
      (options && options.currentTarget && options.currentTarget.dataset) ||
      (options && typeof options === 'object' ? options : {}) || {};
    const slot = typeof dataset.slot === 'string' ? dataset.slot.trim() : '';
    if (!slot) return false;
    try {
      const res = await PveService.equipItem({ slot, itemId: '' });
      this.applyProfile(res.profile);
      wx.showToast({ title: '已卸下', icon: 'success', duration: 1200 });
      return true;
    } catch (error) {
      console.error('[role] unequip item failed', error);
      wx.showToast({ title: error.errMsg || '操作失败', icon: 'none' });
      return false;
    }
  },

  handleEquipmentIconError(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const fallback = typeof dataset.fallback === 'string' ? dataset.fallback : '';
    if (!fallback) {
      return;
    }
    const context = typeof dataset.context === 'string' ? dataset.context : '';
    const indexValue =
      typeof dataset.index === 'number' ? dataset.index : Number(dataset.index);
    if (!Number.isFinite(indexValue) || indexValue < 0) {
      return;
    }
    const updates = {};
    if (context === 'slot') {
      const slots =
        (((this.data || {}).profile || {}).equipment || {}).slots;
      const list = Array.isArray(slots) ? slots : [];
      const target = list[indexValue] && list[indexValue].item ? list[indexValue].item : null;
      if (!target || target.iconUrl === fallback) {
        return;
      }
      updates[`profile.equipment.slots[${indexValue}].item.iconUrl`] = fallback;
    } else if (context === 'inventory') {
      const inventory =
        (((this.data || {}).profile || {}).equipment || {}).inventory;
      const list = Array.isArray(inventory) ? inventory : [];
      const target = list[indexValue] || null;
      if (!target || target.iconUrl === fallback) {
        return;
      }
      updates[`profile.equipment.inventory[${indexValue}].iconUrl`] = fallback;
    } else if (context === 'storage') {
      const categoryIndexValue =
        typeof dataset.categoryIndex === 'number' ? dataset.categoryIndex : Number(dataset.categoryIndex);
      if (!Number.isFinite(categoryIndexValue) || categoryIndexValue < 0) {
        return;
      }
      const storageCategories = Array.isArray(this.data.storageCategories) ? this.data.storageCategories : [];
      const storageCategory = storageCategories[categoryIndexValue];
      const activeCategoryData = this.data.activeStorageCategoryData || null;
      const activeSlots = activeCategoryData && Array.isArray(activeCategoryData.slots) ? activeCategoryData.slots : [];
      const storageSlots = storageCategory && Array.isArray(storageCategory.slots) ? storageCategory.slots : [];
      if (activeSlots[indexValue] && activeSlots[indexValue].iconUrl !== fallback) {
        updates[`activeStorageCategoryData.slots[${indexValue}].iconUrl`] = fallback;
      }
      if (
        activeCategoryData &&
        Array.isArray(activeCategoryData.items) &&
        activeCategoryData.items[indexValue] &&
        activeCategoryData.items[indexValue].iconUrl !== fallback
      ) {
        updates[`activeStorageCategoryData.items[${indexValue}].iconUrl`] = fallback;
      }
      if (storageSlots[indexValue] && storageSlots[indexValue].iconUrl !== fallback) {
        updates[`storageCategories[${categoryIndexValue}].slots[${indexValue}].iconUrl`] = fallback;
      }
      if (
        storageCategory &&
        Array.isArray(storageCategory.items) &&
        storageCategory.items[indexValue] &&
        storageCategory.items[indexValue].iconUrl !== fallback
      ) {
        updates[`storageCategories[${categoryIndexValue}].items[${indexValue}].iconUrl`] = fallback;
      }
      const profileStorage =
        (((this.data || {}).profile || {}).equipment || {}).storage;
      const profileCategories =
        profileStorage && Array.isArray(profileStorage.categories) ? profileStorage.categories : [];
      const profileCategory = profileCategories[categoryIndexValue];
      if (
        profileCategory &&
        Array.isArray(profileCategory.items) &&
        profileCategory.items[indexValue] &&
        profileCategory.items[indexValue].iconUrl !== fallback
      ) {
        updates[`profile.equipment.storage.categories[${categoryIndexValue}].items[${indexValue}].iconUrl`] = fallback;
      }
      if (!Object.keys(updates).length) {
        return;
      }
    } else {
      return;
    }
    this.setData(updates);
  },

  handleEquipmentTap(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const rawItem = dataset.item;
    if (!rawItem) {
      this.closeEquipmentTooltip();
      return;
    }
    const slot = (typeof dataset.slot === 'string' && dataset.slot.trim()) || rawItem.slot || '';
    const source = dataset.source || 'inventory';
    const inventoryId = dataset.inventoryId || rawItem.inventoryId || '';
    const itemId = rawItem.itemId || '';
    const lockKey = buildTooltipLockKey({
      source,
      slot,
      inventoryId,
      itemId
    });
    if (this.tooltipLock && this.tooltipLock.key === lockKey && this.tooltipLock.expiresAt > Date.now()) {
      this.tooltipLock = null;
      return;
    }
    this.tooltipLock = null;
    const slotLabel = dataset.slotLabel || rawItem.slotLabel || '';
    const category = typeof dataset.category === 'string' ? dataset.category : rawItem.storageCategory || '';
    this.openEquipmentTooltip({
      source,
      slot,
      slotLabel,
      item: rawItem,
      inventoryId,
      mode: 'default',
      category
    });
  },

  handleEquipmentLongPress(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const rawItem = dataset.item;
    if (!rawItem) {
      return;
    }
    const slot = (typeof dataset.slot === 'string' && dataset.slot.trim()) || rawItem.slot || '';
    const source = dataset.source || 'inventory';
    const inventoryId = dataset.inventoryId || rawItem.inventoryId || '';
    const itemId = rawItem.itemId || '';
    const lockKey = buildTooltipLockKey({
      source,
      slot,
      inventoryId,
      itemId
    });
    this.tooltipLock = { key: lockKey, expiresAt: Date.now() + 500 };
    const slotLabel = dataset.slotLabel || rawItem.slotLabel || '';
    const category = typeof dataset.category === 'string' ? dataset.category : rawItem.storageCategory || '';
    this.openEquipmentTooltip({
      source,
      slot,
      slotLabel,
      item: rawItem,
      inventoryId,
      mode: 'delete',
      category
    });
  },

  async handleStorageItemAction(event) {
    const tooltip = this.data && this.data.equipmentTooltip;
    if (!tooltip || tooltip.mode === 'delete' || !tooltip.item) {
      return;
    }
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const requestedAction = typeof dataset.action === 'string' ? dataset.action.trim() : '';
    const inventoryId = (tooltip.item.inventoryId || tooltip.inventoryId || '').trim();
    if (!inventoryId) {
      wx.showToast({ title: '物品信息缺失', icon: 'none' });
      return;
    }
    const actions = Array.isArray(tooltip.item.actions) ? tooltip.item.actions : [];
    const primaryAction = tooltip.item.primaryAction && tooltip.item.primaryAction.key
      ? tooltip.item.primaryAction
      : null;
    const resolvedAction =
      actions.find((action) => action && action.key === requestedAction) || primaryAction || actions[0] || null;
    const actionKey = resolvedAction && resolvedAction.key ? resolvedAction.key : requestedAction || 'use';
    if (actionKey !== 'use') {
      wx.showToast({ title: '暂不支持该操作', icon: 'none' });
      return;
    }
    if (this.data && this.data.equipmentTooltip && this.data.equipmentTooltip.using) {
      return;
    }
    const itemName = tooltip.item.name || tooltip.item.shortName || '道具';
    this.setData({
      'equipmentTooltip.using': true,
      'equipmentTooltip.pendingAction': actionKey
    });
    try {
      const res = await PveService.useStorageItem({ inventoryId, actionKey });
      if (res && res.profile) {
        this.applyProfile(res.profile);
      }
      if (res && res.unlockTitle) {
        wx.showToast({
          title: res.unlockTitle.alreadyUnlocked ? '称号已解锁' : '称号解锁成功',
          icon: 'success'
        });
      } else if (res && res.unlockBackground) {
        wx.showToast({ title: '背景解锁成功', icon: 'success' });
      } else if (res && Array.isArray(res.acquiredSkills) && res.acquiredSkills.length) {
        wx.showToast({
          title: `获得 ${res.acquiredSkills.length} 个技能`,
          icon: 'success'
        });
      } else {
        wx.showToast({ title: `已使用${itemName}`, icon: 'success' });
      }
      this.closeEquipmentTooltip();
    } catch (error) {
      console.error('[role] use storage item failed', error);
      wx.showToast({ title: (error && error.errMsg) || '操作失败', icon: 'none' });
      this.setData({ 'equipmentTooltip.using': false, 'equipmentTooltip.pendingAction': '' });
      return;
    }
    this.setData({ 'equipmentTooltip.using': false, 'equipmentTooltip.pendingAction': '' });
  },

  openEquipmentTooltip(options = {}) {
    const rawItem = options && options.item;
    if (!rawItem) {
      this.closeEquipmentTooltip();
      return;
    }
    const slot = (typeof options.slot === 'string' && options.slot.trim()) || rawItem.slot || '';
    const source = options.source || 'inventory';
    const mode = normalizeTooltipMode(options.mode);
    const inventoryId =
      (typeof options.inventoryId === 'string' && options.inventoryId.trim()) || rawItem.inventoryId || '';
    const slotLabel = options.slotLabel || rawItem.slotLabel || '';
    const category = typeof options.category === 'string' ? options.category : rawItem.storageCategory || '';
    const profile = (this.data && this.data.profile) || null;
    const isEquipment =
      (rawItem && rawItem.kind === 'equipment') || !!normalizeSlotValue(slot || rawItem.slot || '');
    const equippedItem = isEquipment
      ? findEquippedItemFromProfile(profile, slot || rawItem.slot || '', rawItem.itemId)
      : null;
    const currentTooltip = this.data && this.data.equipmentTooltip;
    if (
      currentTooltip &&
      currentTooltip.item &&
      rawItem.itemId &&
      currentTooltip.item.itemId === rawItem.itemId &&
      currentTooltip.source === source &&
      currentTooltip.slot === slot &&
      normalizeTooltipMode(currentTooltip.mode) === mode &&
      ((currentTooltip.inventoryId || '') === (inventoryId || ''))
    ) {
      this.closeEquipmentTooltip();
      return;
    }
    const tooltip = {
      visible: true,
      source,
      slot,
      slotLabel,
      item: { ...rawItem },
      inventoryId: inventoryId || '',
      mode,
      category,
      deleting: false
    };
    const deleteState = resolveTooltipDeleteState(tooltip);
    tooltip.canDelete = deleteState.canDelete;
    tooltip.deleteDisabledReason = deleteState.reason;
    if (equippedItem) {
      tooltip.equippedItem = equippedItem;
    }
    if (source === 'storage') {
      this.acknowledgeStorageItem(rawItem);
    }
    this.setData({ equipmentTooltip: tooltip });
  },

  closeEquipmentTooltip() {
    this.tooltipLock = null;
    this.setData({ equipmentTooltip: null });
  },

  async handleEquipFromTooltip() {
    const tooltip = this.data.equipmentTooltip;
    if (!tooltip || !tooltip.item || !tooltip.item.itemId) {
      return;
    }
    const slot =
      (typeof tooltip.slot === 'string' && tooltip.slot.trim()) ||
      (typeof tooltip.item.slot === 'string' ? tooltip.item.slot : '');
    const inventoryId = tooltip.item.inventoryId || tooltip.inventoryId || '';
    const success = await this.handleEquipItem({
      itemId: tooltip.item.itemId,
      slot,
      inventoryId
    });
    if (success) {
      this.closeEquipmentTooltip();
    }
  },

  async handleUnequipFromTooltip(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const tooltip = this.data.equipmentTooltip;
    const slot =
      (typeof dataset.slot === 'string' && dataset.slot.trim()) ||
      (tooltip && (tooltip.slot || (tooltip.item && tooltip.item.slot))) ||
      '';
    if (!slot) {
      return;
    }
    const success = await this.handleUnequipItem({ slot });
    if (success) {
      this.closeEquipmentTooltip();
    }
  },

  handleDeleteFromTooltip() {
    const tooltip = this.data && this.data.equipmentTooltip;
    if (!tooltip || normalizeTooltipMode(tooltip.mode) !== 'delete') {
      return;
    }
    if (tooltip.deleting) {
      return;
    }
    if (!tooltip.canDelete) {
      if (tooltip.deleteDisabledReason) {
        wx.showToast({ title: tooltip.deleteDisabledReason, icon: 'none' });
      }
      return;
    }
    const itemName =
      (tooltip.item && (tooltip.item.name || tooltip.item.shortName)) || tooltip.slotLabel || '该物品';
    wx.showModal({
      title: '删除物品',
      content: `确定要删除「${itemName}」吗？删除后无法恢复。`,
      confirmText: '删除',
      confirmColor: '#fa5151',
      cancelText: '保留',
      success: (res) => {
        if (res.confirm) {
          this.performDeleteItem();
        }
      }
    });
  },

  async performDeleteItem() {
    const tooltip = this.data && this.data.equipmentTooltip;
    if (!tooltip || normalizeTooltipMode(tooltip.mode) !== 'delete' || !tooltip.canDelete || tooltip.deleting) {
      return;
    }
    const inventoryId = tooltip.inventoryId || (tooltip.item && tooltip.item.inventoryId) || '';
    if (!inventoryId) {
      wx.showToast({ title: '缺少物品信息', icon: 'none' });
      return;
    }
    const category = tooltip.category || (tooltip.item && tooltip.item.storageCategory) || '';
    this.setData({ 'equipmentTooltip.deleting': true });
    try {
      const res = await PveService.discardItem({ inventoryId, category });
      if (res && res.profile) {
        this.applyProfile(res.profile);
      }
      wx.showToast({ title: '已删除', icon: 'success', duration: 1200 });
      this.closeEquipmentTooltip();
    } catch (error) {
      console.error('[role] discard item failed', error);
      wx.showToast({ title: error.errMsg || '删除失败', icon: 'none' });
      this.setData({ 'equipmentTooltip.deleting': false });
    }
  },

  handleStorageCategoryChange(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const key = typeof dataset.key === 'string' ? dataset.key : '';
    if (!key || key === this.data.activeStorageCategory) {
      return;
    }
    const categories = Array.isArray(this.data.storageCategories) ? this.data.storageCategories : [];
    if (!categories.some((category) => category.key === key)) {
      return;
    }
    const activeCategory = categories.find((category) => category.key === key) || null;
    const categoryIndex = categories.findIndex((category) => category.key === key);
    this.setData({
      activeStorageCategory: key,
      activeStorageCategoryData: activeCategory,
      activeStorageCategoryIndex: categoryIndex
    });
  },

  async handleUpgradeStorage() {
    const category = this.data.activeStorageCategory;
    if (!category || this.data.storageUpgrading) {
      return;
    }
    const storageMeta = this.data.storageMeta;
    if (storageMeta) {
      const limit =
        typeof storageMeta.upgradeLimit === 'number' && storageMeta.upgradeLimit > 0
          ? storageMeta.upgradeLimit
          : null;
      const upgrades = typeof storageMeta.upgrades === 'number' ? storageMeta.upgrades : 0;
      if (limit !== null && upgrades >= limit) {
        wx.showToast({ title: '储物空间已达上限', icon: 'none' });
        return;
      }
      const available = typeof storageMeta.upgradeAvailable === 'number' ? storageMeta.upgradeAvailable : null;
      const fallbackRemaining =
        available === null && typeof storageMeta.upgradesRemaining === 'number'
          ? storageMeta.upgradesRemaining
          : null;
      const remaining = available !== null ? available : fallbackRemaining;
      if (remaining !== null && remaining <= 0) {
        wx.showToast({ title: '升级次数不足', icon: 'none' });
        return;
      }
    }
    this.setData({ storageUpgrading: true });
    try {
      const res = await PveService.upgradeStorage({ category });
      const updatedProfile = (res && res.profile) || this.data.profile;
      this.applyProfile(updatedProfile, { storageUpgrading: false });
      wx.showToast({ title: '储物空间已扩展', icon: 'success', duration: 1200 });
    } catch (error) {
      console.error('[role] upgrade storage failed', error);
      wx.showToast({ title: error.errMsg || '升级失败', icon: 'none' });
      this.setData({ storageUpgrading: false });
    }
  },

  noop() {},

  handleAllocate(event) {
    const mode = event.currentTarget.dataset.mode;
    if (mode === 'auto') {
      this.autoAllocate();
      return;
    }
    this.handleSubmitAllocations();
  },

  handleSubmitAllocations() {
    const profile = this.data.profile;
    if (!profile || !profile.attributes) {
      wx.showToast({ title: '暂无角色属性', icon: 'none' });
      return;
    }
    const available = Math.max(0, Number(profile.attributes.attributePoints) || 0);
    if (available <= 0) {
      wx.showToast({ title: '暂无可用属性点', icon: 'none' });
      return;
    }
    const adjustments = this.data.attributeAdjustments || {};
    const allocations = {};
    Object.keys(adjustments).forEach((key) => {
      const value = Math.max(0, Math.floor(Number(adjustments[key]) || 0));
      if (value > 0) {
        allocations[key] = value;
      }
    });
    if (!Object.keys(allocations).length) {
      wx.showToast({ title: '请先设置分配点数', icon: 'none' });
      return;
    }
    const total = Object.keys(allocations).reduce((sum, attrKey) => sum + allocations[attrKey], 0);
    if (total > available) {
      wx.showToast({ title: '分配点数超过可用上限', icon: 'none' });
      return;
    }
    this.clearAllAttributeAdjustTimers();
    this.allocatePoints(allocations);
  },

  updateAttributeAdjustments(key, value) {
    if (!key || !ALLOCATABLE_KEYS.includes(key)) {
      return;
    }
    const profile = this.data.profile;
    if (!profile || !profile.attributes) {
      return;
    }
    const available = Math.max(0, Number(profile.attributes.attributePoints) || 0);
    const adjustments = { ...(this.data.attributeAdjustments || {}) };
    const sanitized = Math.max(0, Math.floor(Number(value) || 0));
    const keys = Object.keys(adjustments);
    let totalOthers = 0;
    keys.forEach((attrKey) => {
      if (attrKey !== key) {
        const current = Math.max(0, Math.floor(Number(adjustments[attrKey]) || 0));
        totalOthers += current;
      }
    });
    const remaining = Math.max(0, available - totalOthers);
    let clamped = sanitized;
    if (clamped > remaining) {
      clamped = remaining;
    }
    if (clamped <= 0) {
      delete adjustments[key];
    } else {
      adjustments[key] = clamped;
    }
    const total = Object.keys(adjustments).reduce((sum, attrKey) => {
      const current = Math.max(0, Math.floor(Number(adjustments[attrKey]) || 0));
      return sum + current;
    }, 0);
    const leftover = Math.max(0, available - total);
    this.setData({
      attributeAdjustments: adjustments,
      attributeAllocationTotal: total,
      attributeAllocationRemaining: leftover
    });
  },

  adjustAttributeByDelta(key, delta) {
    if (!key || !delta || !ALLOCATABLE_KEYS.includes(key)) {
      return;
    }
    const adjustments = this.data.attributeAdjustments || {};
    const current = Math.max(0, Math.floor(Number(adjustments[key]) || 0));
    const next = Math.max(0, current + delta);
    this.updateAttributeAdjustments(key, next);
  },

  handleAttributeAdjustTap(event) {
    const { key, direction } = event.currentTarget.dataset || {};
    if (!key || !direction || !ALLOCATABLE_KEYS.includes(key)) {
      return;
    }
    if (this.attributeAdjustTapSuppress && this.attributeAdjustTapSuppress[key]) {
      const expire = this.attributeAdjustTapSuppress[key];
      if (Date.now() < expire) {
        return;
      }
      delete this.attributeAdjustTapSuppress[key];
    }
    const state = this.attributeAdjustTimers && this.attributeAdjustTimers[key];
    if (state && state.active) {
      return;
    }
    const delta = direction === 'increase' ? 1 : -1;
    this.adjustAttributeByDelta(key, delta);
  },

  handleAttributeInput(event) {
    const { key } = event.currentTarget.dataset || {};
    if (!key || !ALLOCATABLE_KEYS.includes(key)) {
      return;
    }
    const value = event && event.detail ? event.detail.value : '';
    if (value === '') {
      this.updateAttributeAdjustments(key, 0);
      return;
    }
    this.updateAttributeAdjustments(key, value);
  },

  handleAttributeAdjustTouchStart(event) {
    const { key, direction } = event.currentTarget.dataset || {};
    if (!key || !direction || !ALLOCATABLE_KEYS.includes(key)) {
      return;
    }
    if (!this.attributeAdjustTimers) {
      this.attributeAdjustTimers = {};
    }
    this.clearAttributeAdjustTimer(key);
    const delta = direction === 'increase' ? 1 : -1;
    const startTime = Date.now();
    const state = {
      direction,
      delta,
      startTime,
      active: false,
      timeout: null,
      timer: null
    };
    state.timeout = setTimeout(() => {
      state.active = true;
      this.adjustAttributeByDelta(key, delta);
      state.timer = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const step = elapsed >= 5000 ? delta * 5 : delta;
        this.adjustAttributeByDelta(key, step);
      }, 200);
    }, 400);
    this.attributeAdjustTimers[key] = state;
  },

  handleAttributeAdjustTouchEnd(event) {
    const { key } = event.currentTarget.dataset || {};
    if (!key || !ALLOCATABLE_KEYS.includes(key)) {
      return;
    }
    const state = this.attributeAdjustTimers ? this.attributeAdjustTimers[key] : null;
    const wasActive = state && state.active;
    this.clearAttributeAdjustTimer(key);
    if (wasActive) {
      if (!this.attributeAdjustTapSuppress) {
        this.attributeAdjustTapSuppress = {};
      }
      this.attributeAdjustTapSuppress[key] = Date.now() + 250;
    }
  },

  clearAttributeAdjustTimer(key) {
    if (!this.attributeAdjustTimers) {
      this.attributeAdjustTimers = {};
    }
    const state = this.attributeAdjustTimers[key];
    if (!state) {
      return;
    }
    if (state.timeout) {
      clearTimeout(state.timeout);
    }
    if (state.timer) {
      clearInterval(state.timer);
    }
    delete this.attributeAdjustTimers[key];
  },

  clearAllAttributeAdjustTimers() {
    if (this.attributeAdjustTimers) {
      const keys = Object.keys(this.attributeAdjustTimers);
      keys.forEach((key) => {
        this.clearAttributeAdjustTimer(key);
      });
    }
    this.attributeAdjustTimers = {};
    this.attributeAdjustTapSuppress = {};
  },

  handleResetAttributes() {
    const profile = this.data.profile;
    const attributes = profile && profile.attributes;
    const available = attributes ? Number(attributes.respecAvailable || 0) : 0;
    if (!attributes || available <= 0) {
      wx.showToast({ title: '洗点次数不足', icon: 'none' });
      return;
    }
    if (this.data.resetting) {
      return;
    }
    const content = `洗点将返还所有已分配的属性点，本次后剩余 ${available - 1} 次。`;
    wx.showModal({
      title: '确认洗点',
      content,
      confirmText: '立即洗点',
      cancelText: '暂不',
      success: (res) => {
        if (res.confirm) {
          this.performResetAttributes();
        }
      }
    });
  },

  async performResetAttributes() {
    if (this.data.resetting) {
      return;
    }
    this.setData({ resetting: true });
    try {
      const res = await PveService.resetAttributes();
      const updatedProfile = res && res.profile ? res.profile : this.data.profile;
      this.applyProfile(updatedProfile, { resetting: false });
      wx.showToast({ title: '洗点完成', icon: 'success', duration: 1200 });
    } catch (error) {
      console.error('[role] reset attributes failed', error);
      wx.showToast({ title: error.errMsg || '洗点失败', icon: 'none' });
      this.setData({ resetting: false });
    }
  },

  async autoAllocate() {
    const profile = this.data.profile;
    if (!profile || !profile.attributes) return;
    const points = Number(profile.attributes.attributePoints || 0);
    if (points <= 0) {
      wx.showToast({ title: '暂无可用属性点', icon: 'none' });
      return;
    }
    const keys = (profile.attributes.attributeList || [])
      .filter((item) => ALLOCATABLE_KEYS.includes(item.key))
      .map((item) => item.key);
    if (!keys.length) {
      wx.showToast({ title: '暂无可分配属性', icon: 'none' });
      return;
    }
    const allocations = {};
    const base = Math.floor(points / keys.length);
    let remainder = points % keys.length;
    keys.forEach((key) => {
      allocations[key] = base + (remainder > 0 ? 1 : 0);
      if (remainder > 0) {
        remainder -= 1;
      }
    });
    this.clearAllAttributeAdjustTimers();
    this.setData({
      attributeAdjustments: {},
      attributeAllocationTotal: 0,
      attributeAllocationRemaining: 0
    });
    await this.allocatePoints(allocations);
  },

  async allocatePoints(allocations) {
    if (!allocations || !Object.keys(allocations).length) {
      return;
    }
    try {
      const res = await PveService.allocatePoints(allocations);
      this.applyProfile(res.profile);
      wx.showToast({ title: '属性已分配', icon: 'success', duration: 1200 });
    } catch (error) {
      console.error('[role] allocate points failed', error);
      wx.showToast({ title: error.errMsg || '分配失败', icon: 'none' });
    }
  }
});
