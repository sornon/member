import { AdminService } from '../../../services/api';
import { listAllAvatars, normalizeAvatarUnlocks } from '../../../utils/avatar-catalog';
import { sanitizeEquipmentProfile } from '../../../utils/equipment';

const RENAME_SOURCE_LABELS = {
  admin: '管理员调整',
  manual: '会员修改',
  system: '系统同步'
};

function formatEquipmentSlots(profile) {
  if (!profile || !profile.equipment || !Array.isArray(profile.equipment.slots)) {
    return [];
  }
  return profile.equipment.slots
    .map((slot) => {
      const item = slot && slot.item ? slot.item : null;
      if (!item) {
        return null;
      }
      return {
        slot: slot.slot,
        slotLabel: slot.slotLabel || '',
        inventoryId: item.inventoryId || item.itemId || '',
        itemId: item.itemId || '',
        name: item.name || '',
        qualityLabel: item.qualityLabel || '',
        qualityColor: item.qualityColor || '#a5adb8',
        refine: typeof item.refine === 'number' ? item.refine : 0
      };
    })
    .filter((slot) => !!slot && slot.name);
}

function formatEquipmentInventory(profile) {
  if (!profile || !profile.equipment || !Array.isArray(profile.equipment.inventory)) {
    return [];
  }
  return profile.equipment.inventory.map((item) => ({
    inventoryId: item.inventoryId || item.itemId || '',
    itemId: item.itemId,
    name: item.name,
    qualityLabel: item.qualityLabel,
    qualityColor: item.qualityColor,
    slotLabel: item.slotLabel || '',
    obtainedAtText: item.obtainedAtText || '',
    equipped: !!item.equipped,
    refine: typeof item.refine === 'number' ? item.refine : 0,
    refineLabel: item.refineLabel || '',
    statsText: Array.isArray(item.statsText) ? item.statsText : [],
    slot: item.slot || '',
    level: typeof item.level === 'number' ? item.level : 1,
    favorite: !!item.favorite
  }));
}

function buildCatalogLabel(item) {
  if (!item) {
    return '';
  }
  const segments = [item.name || '未知装备'];
  if (item.qualityLabel) {
    segments.push(item.qualityLabel);
  }
  if (item.slotLabel) {
    segments.push(item.slotLabel);
  }
  return segments.join(' · ');
}

const EQUIPMENT_FILTER_DEFAULT = {
  slot: 'all',
  quality: 'all'
};

function buildEquipmentFilterOptions(catalog, valueKey, labelKey, defaultLabel) {
  const options = [{ value: 'all', label: defaultLabel }];
  const seen = new Set();
  (catalog || []).forEach((item) => {
    if (!item || !item[valueKey]) {
      return;
    }
    const value = item[valueKey];
    if (seen.has(value)) {
      return;
    }
    seen.add(value);
    options.push({
      value,
      label: item[labelKey] || '未分类'
    });
  });
  return options;
}

function filterEquipmentCatalog(catalog, filters = EQUIPMENT_FILTER_DEFAULT) {
  const list = Array.isArray(catalog) ? catalog : [];
  const slot = filters && filters.slot;
  const quality = filters && filters.quality;
  return list.filter((item) => {
    if (!item) {
      return false;
    }
    const slotMatched = !slot || slot === 'all' || item.slot === slot;
    const qualityMatched = !quality || quality === 'all' || item.quality === quality;
    return slotMatched && qualityMatched;
  });
}

function resolveFilteredSelection(catalog, currentId) {
  const list = Array.isArray(catalog) ? catalog : [];
  if (!list.length) {
    return { id: '', index: -1 };
  }
  const existingIndex = list.findIndex((item) => item.id === currentId);
  if (existingIndex >= 0) {
    return { id: currentId, index: existingIndex };
  }
  return { id: list[0].id, index: 0 };
}

const RAW_AVATAR_OPTIONS = listAllAvatars();

const AVATAR_OPTION_GROUPS = [
  {
    gender: 'male',
    label: '男修',
    options: RAW_AVATAR_OPTIONS.filter((item) => item.gender === 'male').map((item) => ({
      id: item.id,
      label: item.name,
      disabled: item.rarity === 'c'
    }))
  },
  {
    gender: 'female',
    label: '女修',
    options: RAW_AVATAR_OPTIONS.filter((item) => item.gender === 'female').map((item) => ({
      id: item.id,
      label: item.name,
      disabled: item.rarity === 'c'
    }))
  }
];

function buildAvatarOptionGroups(unlocks = []) {
  const unlockSet = new Set(normalizeAvatarUnlocks(unlocks));
  return AVATAR_OPTION_GROUPS.map((group) => ({
    gender: group.gender,
    label: group.label,
    options: group.options.map((option) => ({
      ...option,
      checked: option.disabled || unlockSet.has(option.id)
    }))
  }));
}

function ensureMemberRole(roles) {
  const list = Array.isArray(roles) ? [...new Set(roles)] : [];
  if (!list.includes('member')) {
    list.push('member');
  }
  return list;
}

function pad(value) {
  return value < 10 ? `0${value}` : `${value}`;
}

function formatHistoryTime(value) {
  if (!value) {
    return '—';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatRenameHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }
  return history
    .slice()
    .reverse()
    .map((item, index) => {
      let timestamp = Date.now();
      if (item && item.changedAt) {
        const date = item.changedAt instanceof Date ? item.changedAt : new Date(item.changedAt);
        if (!Number.isNaN(date.getTime())) {
          timestamp = date.getTime();
        }
      }
      const key = item && item.id ? item.id : `${timestamp}-${index}`;
      const source = item && item.source ? item.source : 'manual';
      const label = RENAME_SOURCE_LABELS[source] || '会员修改';
      const timeLabel = item && item.changedAtLabel ? item.changedAtLabel : formatHistoryTime(item && item.changedAt);
      return {
        id: key,
        previous: (item && item.previous) || '—',
        current: (item && item.current) || '—',
        time: timeLabel || '—',
        source: label
      };
    });
}

Page({
  data: {
    memberId: '',
    loading: true,
    saving: false,
    member: null,
    levels: [],
    levelIndex: 0,
    currentLevelName: '',
    roleOptions: [
      { value: 'member', label: '会员', checked: false, disabled: true },
      { value: 'admin', label: '管理员', checked: false },
      { value: 'developer', label: '开发', checked: false }
    ],
    avatarOptionGroups: buildAvatarOptionGroups([]),
    form: {
      nickName: '',
      mobile: '',
      experience: '',
      cashBalance: '',
      stoneBalance: '',
      levelId: '',
      roles: [],
      renameCredits: '',
      respecAvailable: '',
      roomUsageCount: '',
      avatarUnlocks: []
    },
    rechargeVisible: false,
    rechargeAmount: '',
    renameHistory: [],
    pveProfile: null,
    equipmentSlots: [],
    equipmentInventory: [],
    equipmentCatalog: [],
    equipmentCatalogLoaded: false,
    filteredEquipmentCatalog: [],
    equipmentFilters: { ...EQUIPMENT_FILTER_DEFAULT },
    equipmentFilterSlotOptions: [{ value: 'all', label: '全部部位' }],
    equipmentFilterQualityOptions: [{ value: 'all', label: '全部品质' }],
    equipmentFilterSlotIndex: 0,
    equipmentFilterQualityIndex: 0,
    equipmentProfileLoaded: false,
    equipmentDialogVisible: false,
    equipmentSelectionId: '',
    equipmentSelectionIndex: -1,
    grantingEquipment: false,
    removingEquipmentInventoryId: '',
    equipmentEditDialogVisible: false,
    equipmentEditItem: null,
    equipmentEditForm: { refine: '' },
    updatingEquipment: false
  },

  onLoad(options) {
    const { id } = options;
    if (!id) {
      wx.showToast({ title: '缺少会员编号', icon: 'none' });
      return;
    }
    this.setData({ memberId: id });
  },

  onShow() {
    if (!this.data.memberId) {
      return;
    }
    this.loadMember(this.data.memberId);
    this.loadEquipmentCatalog();
  },

  onPullDownRefresh() {
    if (!this.data.memberId) return;
    this.loadMember(this.data.memberId).finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  async loadMember(memberId) {
    this.setData({ loading: true });
    try {
      const detail = await AdminService.getMemberDetail(memberId);
      this.applyDetail(detail);
    } catch (error) {
      console.error('[admin:member:detail]', error);
      this.setData({ loading: false });
      wx.showToast({ title: error.errMsg || error.message || '加载失败', icon: 'none' });
    }
  },

  async loadEquipmentCatalog(force = false) {
    if (this.data.equipmentCatalogLoaded && !force) {
      return;
    }
    try {
      const res = await AdminService.listEquipmentCatalog();
      const catalog = Array.isArray(res && res.items)
        ? res.items.map((item) => ({ ...item, label: buildCatalogLabel(item) }))
        : [];
      const slotOptions = buildEquipmentFilterOptions(catalog, 'slot', 'slotLabel', '全部部位');
      const qualityOptions = buildEquipmentFilterOptions(catalog, 'quality', 'qualityLabel', '全部品质');
      const currentFilters = this.data.equipmentFilters || { ...EQUIPMENT_FILTER_DEFAULT };
      let slotIndex = slotOptions.findIndex((option) => option.value === currentFilters.slot);
      if (slotIndex < 0) {
        slotIndex = 0;
      }
      let qualityIndex = qualityOptions.findIndex((option) => option.value === currentFilters.quality);
      if (qualityIndex < 0) {
        qualityIndex = 0;
      }
      const filters = {
        slot: slotOptions[slotIndex] ? slotOptions[slotIndex].value : 'all',
        quality: qualityOptions[qualityIndex] ? qualityOptions[qualityIndex].value : 'all'
      };
      const filteredCatalog = filterEquipmentCatalog(catalog, filters);
      const selection = resolveFilteredSelection(filteredCatalog, this.data.equipmentSelectionId);
      this.setData({
        equipmentCatalog: catalog,
        equipmentCatalogLoaded: true,
        equipmentFilters: filters,
        equipmentFilterSlotOptions: slotOptions,
        equipmentFilterQualityOptions: qualityOptions,
        equipmentFilterSlotIndex: slotIndex,
        equipmentFilterQualityIndex: qualityIndex,
        filteredEquipmentCatalog: filteredCatalog,
        equipmentSelectionId: selection.id,
        equipmentSelectionIndex: selection.index
      });
    } catch (error) {
      console.error('[admin] load equipment catalog failed', error);
    }
  },

  applyDetail(detail) {
    if (!detail || !detail.member) return;
    const { member, levels = [] } = detail;
    const levelIndex = Math.max(
      levels.findIndex((level) => level._id === member.levelId),
      0
    );
    const currentLevel = levels[levelIndex] || levels[0] || { _id: '', name: '' };
    const roles = ensureMemberRole(member.roles);
    const roleOptions = (this.data.roleOptions || []).map((option) => ({
      ...option,
      checked: roles.includes(option.value)
    }));
    const avatarUnlocks = normalizeAvatarUnlocks(member.avatarUnlocks);
    this.setData({
      member,
      levels,
      levelIndex,
      currentLevelName: currentLevel.name || '',
      loading: false,
      form: {
        nickName: member.nickName || '',
        mobile: member.mobile || '',
        experience: String(member.experience ?? 0),
        cashBalance: this.formatYuan(member.cashBalance ?? member.balance ?? 0),
        stoneBalance: String(member.stoneBalance ?? 0),
        levelId: member.levelId || currentLevel._id || '',
        roles,
        renameCredits: String(member.renameCredits ?? 0),
        respecAvailable: String(member.pveRespecAvailable ?? 0),
        roomUsageCount: String(member.roomUsageCount ?? 0),
        avatarUnlocks: avatarUnlocks
      },
      roleOptions,
      renameHistory: formatRenameHistory(member.renameHistory),
      avatarOptionGroups: buildAvatarOptionGroups(avatarUnlocks),
      pveProfile: detail.pveProfile || null
    });
    this.applyEquipmentProfile(detail.pveProfile);
  },

  applyEquipmentProfile(profile) {
    const sanitizedProfile = sanitizeEquipmentProfile(profile);
    const hasProfile = !!(sanitizedProfile && sanitizedProfile.equipment);
    const equipmentSlots = hasProfile ? formatEquipmentSlots(sanitizedProfile) : [];
    const equipmentInventory = hasProfile ? formatEquipmentInventory(sanitizedProfile) : [];
    this.setData({
      equipmentSlots,
      equipmentInventory,
      equipmentProfileLoaded: !!sanitizedProfile
    });
  },

  handleInputChange(event) {
    const { field } = event.currentTarget.dataset;
    if (!field) return;
    this.setData({ [`form.${field}`]: event.detail.value });
  },

  handleLevelChange(event) {
    const index = Number(event.detail.value);
    const level = this.data.levels[index];
    if (!level) return;
    this.setData({
      levelIndex: index,
      currentLevelName: level.name || '',
      'form.levelId': level._id
    });
  },

  handleRolesChange(event) {
    const roles = ensureMemberRole(event.detail.value || []);
    const roleOptions = (this.data.roleOptions || []).map((option) => ({
      ...option,
      checked: roles.includes(option.value)
    }));
    this.setData({
      'form.roles': roles,
      roleOptions
    });
  },

  handleAvatarUnlockChange(event) {
    const value = Array.isArray(event.detail.value) ? event.detail.value : [];
    const unlocks = normalizeAvatarUnlocks(value);
    this.setData({
      'form.avatarUnlocks': unlocks,
      avatarOptionGroups: buildAvatarOptionGroups(unlocks)
    });
  },

  showEquipmentGrantDialog() {
    const catalog = this.data.equipmentCatalog || [];
    if (!catalog.length) {
      if (!this.data.equipmentCatalogLoaded) {
        this.loadEquipmentCatalog(true);
        wx.showToast({ title: '装备目录加载中，请稍候', icon: 'none' });
      } else {
        wx.showToast({ title: '暂无可发放的装备', icon: 'none' });
      }
      return;
    }
    const filteredCatalog = this.data.filteredEquipmentCatalog || [];
    let equipmentSelectionId = this.data.equipmentSelectionId;
    let equipmentSelectionIndex = this.data.equipmentSelectionIndex;
    if (filteredCatalog.length) {
      const matchedIndex = filteredCatalog.findIndex((item) => item.id === equipmentSelectionId);
      if (matchedIndex >= 0) {
        equipmentSelectionIndex = matchedIndex;
      } else {
        equipmentSelectionId = filteredCatalog[0].id;
        equipmentSelectionIndex = 0;
      }
    } else {
      equipmentSelectionId = '';
      equipmentSelectionIndex = -1;
      wx.showToast({ title: '当前筛选下暂无装备，请调整筛选条件', icon: 'none' });
    }
    this.setData({
      equipmentDialogVisible: true,
      equipmentSelectionId,
      equipmentSelectionIndex
    });
  },

  hideEquipmentGrantDialog() {
    this.setData({ equipmentDialogVisible: false });
  },

  handleEquipmentSelect(event) {
    const value = event && event.detail ? event.detail.value : '';
    const catalog = this.data.filteredEquipmentCatalog || [];
    const index = catalog.findIndex((item) => item.id === value);
    this.setData({
      equipmentSelectionId: value,
      equipmentSelectionIndex: index
    });
  },

  handleEquipmentSlotFilterChange(event) {
    const index = Number(event && event.detail ? event.detail.value : 0);
    this.applyEquipmentFilterChanges({ slotIndex: Number.isNaN(index) ? 0 : index });
  },

  handleEquipmentQualityFilterChange(event) {
    const index = Number(event && event.detail ? event.detail.value : 0);
    this.applyEquipmentFilterChanges({ qualityIndex: Number.isNaN(index) ? 0 : index });
  },

  applyEquipmentFilterChanges(updates = {}) {
    const slotOptions = this.data.equipmentFilterSlotOptions || [];
    const qualityOptions = this.data.equipmentFilterQualityOptions || [];
    let slotIndex =
      typeof updates.slotIndex === 'number' ? updates.slotIndex : this.data.equipmentFilterSlotIndex || 0;
    let qualityIndex =
      typeof updates.qualityIndex === 'number' ? updates.qualityIndex : this.data.equipmentFilterQualityIndex || 0;
    if (slotIndex < 0 || slotIndex >= slotOptions.length) {
      slotIndex = 0;
    }
    if (qualityIndex < 0 || qualityIndex >= qualityOptions.length) {
      qualityIndex = 0;
    }
    const filters = {
      slot: slotOptions[slotIndex] ? slotOptions[slotIndex].value : 'all',
      quality: qualityOptions[qualityIndex] ? qualityOptions[qualityIndex].value : 'all'
    };
    const filteredCatalog = filterEquipmentCatalog(this.data.equipmentCatalog || [], filters);
    const selection = resolveFilteredSelection(filteredCatalog, this.data.equipmentSelectionId);
    this.setData({
      equipmentFilterSlotIndex: slotIndex,
      equipmentFilterQualityIndex: qualityIndex,
      equipmentFilters: filters,
      filteredEquipmentCatalog: filteredCatalog,
      equipmentSelectionId: selection.id,
      equipmentSelectionIndex: selection.index
    });
  },

  async handleEquipmentGrantConfirm() {
    const itemId = this.data.equipmentSelectionId;
    if (!itemId) {
      wx.showToast({ title: '请选择装备', icon: 'none' });
      return;
    }
    const success = await this.grantEquipmentToMember(itemId);
    if (success) {
      this.hideEquipmentGrantDialog();
    }
  },

  async grantEquipmentToMember(itemId) {
    if (this.data.grantingEquipment || !this.data.memberId || !itemId) {
      return false;
    }
    this.setData({ grantingEquipment: true });
    try {
      const res = await AdminService.grantEquipment({
        memberId: this.data.memberId,
        itemId
      });
      if (res && res.profile) {
        this.applyEquipmentProfile(res.profile);
      }
      wx.showToast({ title: '发放成功', icon: 'success' });
      const catalog = this.data.filteredEquipmentCatalog || [];
      const selectionIndex = catalog.findIndex((item) => item.id === itemId);
      this.setData({
        equipmentSelectionId: itemId,
        equipmentSelectionIndex: selectionIndex
      });
      return true;
    } catch (error) {
      console.error('[admin] grant equipment failed', error);
      wx.showToast({ title: error.errMsg || error.message || '发放失败', icon: 'none' });
      return false;
    } finally {
      this.setData({ grantingEquipment: false });
    }
  },

  async handleEquipmentDelete(event) {
    const { itemId, inventoryId } = (event && event.currentTarget && event.currentTarget.dataset) || {};
    if (!itemId || this.data.removingEquipmentInventoryId) {
      return;
    }
    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: '删除装备',
        content: '确定要删除该装备吗？',
        confirmText: '删除',
        confirmColor: '#ef4444',
        cancelText: '取消',
        success: (res) => resolve(!!(res && res.confirm)),
        fail: () => resolve(false)
      });
    });
    if (!confirmed) {
      return;
    }
    await this.removeEquipmentFromMember(itemId, inventoryId);
  },

  async removeEquipmentFromMember(itemId, inventoryId) {
    if (!itemId || !this.data.memberId || this.data.removingEquipmentInventoryId) {
      return false;
    }
    const pendingId = inventoryId || itemId;
    this.setData({ removingEquipmentInventoryId: pendingId });
    try {
      const res = await AdminService.removeEquipment({
        memberId: this.data.memberId,
        itemId,
        inventoryId
      });
      if (res && res.profile) {
        this.applyEquipmentProfile(res.profile);
      }
      wx.showToast({ title: '删除成功', icon: 'success' });
      return true;
    } catch (error) {
      console.error('[admin] remove equipment failed', error);
      wx.showToast({ title: error.errMsg || error.message || '删除失败', icon: 'none' });
      return false;
    } finally {
      this.setData({ removingEquipmentInventoryId: '' });
    }
  },

  async handleSubmit() {
    if (this.data.saving) return;
    this.setData({ saving: true });
    try {
      const payload = {
        nickName: (this.data.form.nickName || '').trim(),
        mobile: (this.data.form.mobile || '').trim(),
        experience: Number(this.data.form.experience || 0),
        cashBalance: this.parseYuanToFen(this.data.form.cashBalance),
        stoneBalance: Number(this.data.form.stoneBalance || 0),
        levelId: this.data.form.levelId,
        roles: ensureMemberRole(this.data.form.roles),
        renameCredits: this.parseRenameCredits(this.data.form.renameCredits),
        respecAvailable: this.parseRespecAvailable(this.data.form.respecAvailable),
        roomUsageCount: Number(this.data.form.roomUsageCount || 0),
        avatarUnlocks: normalizeAvatarUnlocks(this.data.form.avatarUnlocks)
      };
      const detail = await AdminService.updateMember(this.data.memberId, payload);
      this.applyDetail(detail);
      wx.showToast({ title: '保存成功', icon: 'success' });
    } catch (error) {
      console.error('[admin:member:update]', error);
      wx.showToast({ title: error.errMsg || error.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  handleEquipmentItemLongPress(event) {
    const { itemId, inventoryId } = (event && event.currentTarget && event.currentTarget.dataset) || {};
    if (!itemId) {
      return;
    }
    const inventory = Array.isArray(this.data.equipmentInventory) ? this.data.equipmentInventory : [];
    let item = inventory.find((entry) => entry.inventoryId === inventoryId);
    if (!item) {
      item = inventory.find((entry) => entry.itemId === itemId);
    }
    if (!item) {
      wx.showToast({ title: '未找到装备信息', icon: 'none' });
      return;
    }
    this.setData({
      equipmentEditDialogVisible: true,
      equipmentEditItem: item,
      equipmentEditForm: {
        refine: String(typeof item.refine === 'number' ? item.refine : 0)
      }
    });
  },

  hideEquipmentEditDialog() {
    this.setData({
      equipmentEditDialogVisible: false,
      equipmentEditItem: null,
      equipmentEditForm: { refine: '' }
    });
  },

  handleEquipmentEditRefineInput(event) {
    const value = event && event.detail ? event.detail.value : '';
    this.setData({ 'equipmentEditForm.refine': value });
  },

  async handleEquipmentEditConfirm() {
    if (!this.data.equipmentEditDialogVisible || this.data.updatingEquipment) {
      return;
    }
    const item = this.data.equipmentEditItem;
    if (!item || !item.itemId) {
      wx.showToast({ title: '缺少装备信息', icon: 'none' });
      return;
    }
    const refineInput = Number(this.data.equipmentEditForm.refine);
    const refine = Number.isFinite(refineInput) ? Math.max(0, Math.floor(refineInput)) : 0;
    this.setData({ updatingEquipment: true });
    try {
      const res = await AdminService.updateEquipmentAttributes({
        memberId: this.data.memberId,
        itemId: item.itemId,
        inventoryId: item.inventoryId,
        refine
      });
      if (res && res.profile) {
        this.applyEquipmentProfile(res.profile);
      }
      wx.showToast({ title: '修改成功', icon: 'success' });
      this.hideEquipmentEditDialog();
    } catch (error) {
      console.error('[admin] update equipment attributes failed', error);
      wx.showToast({ title: error.errMsg || error.message || '修改失败', icon: 'none' });
    } finally {
      this.setData({ updatingEquipment: false });
    }
  },

  noop() {},

  showRechargeDialog() {
    this.setData({ rechargeVisible: true, rechargeAmount: '' });
  },

  hideRechargeDialog() {
    this.setData({ rechargeVisible: false, rechargeAmount: '' });
  },

  handleRechargeInput(event) {
    this.setData({ rechargeAmount: event.detail.value });
  },

  async handleRechargeConfirm() {
    if (!this.data.memberId) return;
    const amountFen = this.parseYuanToFen(this.data.rechargeAmount);
    if (!amountFen || amountFen <= 0) {
      wx.showToast({ title: '请输入正确的金额', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '充值中', mask: true });
    try {
      const detail = await AdminService.rechargeMember(this.data.memberId, amountFen);
      this.applyDetail(detail);
      wx.showToast({ title: '充值成功', icon: 'success' });
      this.hideRechargeDialog();
    } catch (error) {
      wx.showToast({ title: error.errMsg || error.message || '充值失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  formatYuan(fen) {
    const value = Number(fen || 0);
    if (!Number.isFinite(value)) {
      return '0.00';
    }
    return (value / 100).toFixed(2);
  },

  parseYuanToFen(input) {
    if (input == null || input === '') {
      return 0;
    }
    const numeric = Number(input);
    if (Number.isFinite(numeric)) {
      return Math.round(numeric * 100);
    }
    if (typeof input === 'string') {
      const sanitized = input.trim().replace(/[^0-9.-]/g, '');
      const parsed = Number(sanitized);
      return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
    }
    return 0;
  },

  parseRenameCredits(input) {
    if (input == null || input === '') {
      return 0;
    }
    if (typeof input === 'number' && Number.isFinite(input)) {
      return Math.max(0, Math.floor(input));
    }
    if (typeof input === 'string') {
      const sanitized = input.trim().replace(/[^0-9]/g, '');
      if (!sanitized) {
        return 0;
      }
      const parsed = Number(sanitized);
      return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
    }
    return 0;
  },

  parseRespecAvailable(input) {
    if (input == null || input === '') {
      return 0;
    }
    if (typeof input === 'number' && Number.isFinite(input)) {
      return Math.max(0, Math.floor(input));
    }
    if (typeof input === 'string') {
      const sanitized = input.trim().replace(/[^0-9]/g, '');
      if (!sanitized) {
        return 0;
      }
      const parsed = Number(sanitized);
      return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
    }
    return 0;
  }
});
