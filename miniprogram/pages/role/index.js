import { PveService, MemberService } from '../../services/api';
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

Page({
  data: {
    loading: true,
    profile: null,
    activeTab: 'character',
    drawing: false,
    resetting: false,
    stoneBalance: 0,
    formattedStoneBalance: formatStones(0),
    equipmentTooltip: null,
    storageCategories: [],
    storageMeta: null,
    activeStorageCategory: 'equipment',
    activeStorageCategoryData: null,
    storageUpgrading: false,
    skillPreview: null
  },

  applyProfile(profile, extraState = {}) {
    const sanitizedProfile = sanitizeEquipmentProfile(profile);
    const storageState = this.buildStorageState(sanitizedProfile);
    const shouldRebuildPreview = !Object.prototype.hasOwnProperty.call(extraState, 'skillPreview');
    const previewState = shouldRebuildPreview ? this.rebuildSkillPreviewState(sanitizedProfile) : {};
    const updates = { ...extraState, profile: sanitizedProfile, ...storageState, ...previewState };
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
      if (!inSlots && !inInventory) {
        updates.equipmentTooltip = null;
      }
    }
    this.setData(updates);
    return sanitizedProfile;
  },

  rebuildSkillPreviewState(profile) {
    const current = (this.data && this.data.skillPreview) || null;
    if (!current) {
      return {};
    }
    const refreshed = this.resolveSkillPreviewFromProfile(profile, current);
    if (refreshed) {
      return { skillPreview: refreshed };
    }
    return { skillPreview: null };
  },

  resolveSkillPreviewFromProfile(profile, preview) {
    if (!preview || !profile || !profile.skills) {
      return null;
    }
    if (preview.source === 'equipped') {
      const slots = Array.isArray(profile.skills.equipped) ? profile.skills.equipped : [];
      const slotIndex = Number(preview.slot);
      if (!Number.isFinite(slotIndex)) {
        return null;
      }
      const match = slots.find((slot) => slot && Number(slot.slot) === slotIndex && slot.detail);
      if (match && match.detail) {
        return this.buildSkillPreviewDetail(match.detail, {
          source: 'equipped',
          slot: slotIndex
        });
      }
      return null;
    }
    const inventory = Array.isArray(profile.skills.inventory) ? profile.skills.inventory : [];
    const skillId = preview.skillId;
    if (!skillId) {
      return null;
    }
    const found = inventory.find((item) => item && item.skillId === skillId);
    if (found) {
      return this.buildSkillPreviewDetail(found, {
        source: 'inventory',
        slot: null
      });
    }
    return null;
  },

  buildSkillPreviewDetail(rawDetail = {}, options = {}) {
    const source = options.source || 'inventory';
    const slot = Number.isFinite(options.slot) ? options.slot : null;
    const highlights = Array.isArray(rawDetail.highlights) ? rawDetail.highlights : [];
    const normalizedHighlights = highlights
      .map((highlight) => (typeof highlight === 'string' ? highlight : ''))
      .filter((highlight) => !!highlight);
    return {
      source,
      slot,
      skillId: rawDetail.skillId || '',
      name: rawDetail.name || '',
      level: Number.isFinite(rawDetail.level) ? rawDetail.level : rawDetail.level || 0,
      qualityLabel: rawDetail.qualityLabel || '',
      qualityColor: rawDetail.qualityColor || '#f1f4ff',
      typeLabel: rawDetail.typeLabel || '',
      disciplineLabel: rawDetail.disciplineLabel || '',
      elementLabel: rawDetail.elementLabel || '',
      resourceText: rawDetail.resourceText || '',
      imprintText: rawDetail.imprintText || '',
      description: rawDetail.description || '',
      obtainedAtText: rawDetail.obtainedAtText || '',
      highlights: normalizedHighlights,
      equipped: source === 'equipped' || !!rawDetail.equipped,
      canUnequip: source === 'equipped' && Number.isFinite(slot),
      canEquip: source !== 'equipped' && !rawDetail.equipped
    };
  },

  buildStorageState(profile) {
    const storageMetaBase = extractStorageMetaFromProfile(profile);
    const storageCategories = this.buildStorageCategories(profile, storageMetaBase);
    const storageMeta = finalizeStorageMeta(storageMetaBase, storageCategories);
    const activeKey = this.resolveActiveStorageCategory(storageCategories);
    const activeCategory = storageCategories.find((category) => category.key === activeKey) || null;
    return {
      storageCategories,
      storageMeta,
      activeStorageCategory: activeKey,
      activeStorageCategoryData: activeCategory
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
        if (!key) {
          return null;
        }
        const label = typeof category.label === 'string' ? category.label : key;
        const items = Array.isArray(category.items) ? category.items : [];
        const normalizedItems = items.map((item, index) => {
          const storageKey = `${key}-${item && item.inventoryId ? item.inventoryId : `${item && item.itemId ? item.itemId : 'item'}-${index}`}`;
          const normalized = { ...item, storageKey };
          if (!normalized.storageCategory) {
            normalized.storageCategory = key;
          }
          return normalized;
        });
        const slotCount = Math.max(capacity, normalizedItems.length);
        const slots = normalizedItems.map((item) => ({ ...item, placeholder: false, storageCategory: key }));
        for (let i = normalizedItems.length; i < slotCount; i += 1) {
          slots.push({ placeholder: true, storageKey: `${key}-placeholder-${i}` });
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

  onLoad(options = {}) {
    this.tooltipLock = null;
    const initialTab = this.normalizeTab(options.tab);
    if (initialTab) {
      this.setData({ activeTab: initialTab });
    }
  },

  onShow() {
    this.fetchProfile();
    this.refreshStoneBalance();
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
      this.applyProfile(res.profile);
      wx.showToast({ title: '已装备', icon: 'success', duration: 1200 });
    } catch (error) {
      console.error('[role] equip skill failed', error);
      wx.showToast({ title: error.errMsg || '操作失败', icon: 'none' });
    }
  },

  async handleUnequipSkill(event) {
    const slot = Number(event.currentTarget.dataset.slot);
    if (!Number.isFinite(slot)) return;
    try {
      const res = await PveService.equipSkill({ skillId: '', slot });
      this.applyProfile(res.profile);
    } catch (error) {
      console.error('[role] unequip skill failed', error);
      wx.showToast({ title: error.errMsg || '操作失败', icon: 'none' });
    }
  },

  openSkillPreview(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const source = dataset.source || '';
    const profile = this.data && this.data.profile;
    if (!profile || !profile.skills) {
      return;
    }
    let preview = null;
    if (source === 'equipped') {
      const slot = Number(dataset.slot);
      if (!Number.isFinite(slot)) {
        return;
      }
      const slots = Array.isArray(profile.skills.equipped) ? profile.skills.equipped : [];
      const match = slots.find((item) => item && Number(item.slot) === slot && item.detail);
      if (match && match.detail) {
        preview = this.buildSkillPreviewDetail(match.detail, { source: 'equipped', slot });
      }
    } else if (source === 'inventory') {
      const skillId = dataset.skillId;
      if (!skillId) {
        return;
      }
      const inventory = Array.isArray(profile.skills.inventory) ? profile.skills.inventory : [];
      const found = inventory.find((item) => item && item.skillId === skillId);
      if (found) {
        preview = this.buildSkillPreviewDetail(found, { source: 'inventory', slot: null });
      }
    }
    if (preview) {
      this.setData({ skillPreview: preview });
    }
  },

  closeSkillPreview() {
    if (this.data && this.data.skillPreview) {
      this.setData({ skillPreview: null });
    }
  },

  async handleSkillPreviewEquip() {
    const preview = (this.data && this.data.skillPreview) || null;
    if (!preview || !preview.skillId || !preview.canEquip) {
      return;
    }
    try {
      const res = await PveService.equipSkill({ skillId: preview.skillId });
      this.applyProfile(res.profile, { skillPreview: null });
      wx.showToast({ title: '已装备', icon: 'success', duration: 1200 });
    } catch (error) {
      console.error('[role] equip skill from preview failed', error);
      wx.showToast({ title: error.errMsg || '操作失败', icon: 'none' });
    }
  },

  async handleSkillPreviewUnequip() {
    const preview = (this.data && this.data.skillPreview) || null;
    if (!preview || !preview.canUnequip) {
      return;
    }
    const slot = Number(preview.slot);
    if (!Number.isFinite(slot)) {
      return;
    }
    try {
      const res = await PveService.equipSkill({ skillId: '', slot });
      this.applyProfile(res.profile, { skillPreview: null });
      wx.showToast({ title: '已卸下', icon: 'success', duration: 1200 });
    } catch (error) {
      console.error('[role] unequip skill from preview failed', error);
      wx.showToast({ title: error.errMsg || '操作失败', icon: 'none' });
    }
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
    this.setData({
      activeStorageCategory: key,
      activeStorageCategoryData: activeCategory
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
    const profile = this.data.profile;
    if (!profile || !profile.attributes || profile.attributes.attributePoints <= 0) {
      wx.showToast({ title: '暂无可用属性点', icon: 'none' });
      return;
    }
    const options = (profile.attributes.attributeList || []).filter((item) =>
      ALLOCATABLE_KEYS.includes(item.key)
    );
    if (!options.length) {
      wx.showToast({ title: '暂无可分配属性', icon: 'none' });
      return;
    }
    wx.showActionSheet({
      itemList: options.map((item) => `${item.label} +${item.step}`),
      success: ({ tapIndex }) => {
        const target = options[tapIndex];
        if (target) {
          this.allocatePoints({ [target.key]: 1 });
        }
      }
    });
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
