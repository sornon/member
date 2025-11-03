import { AdminService, PveService } from '../../../services/api';
import {
  listAllAvatars,
  normalizeAvatarUnlocks as normalizeAvatarUnlocksStrict,
  registerCustomAvatars,
  normalizeAvatarCatalog,
  buildAvatarUrlById,
  buildAvatarUrlByFile,
  normalizeAvatarFileName
} from '../../../utils/avatar-catalog';
import { sanitizeEquipmentProfile, buildEquipmentIconPaths } from '../../../utils/equipment';
const {
  buildTitleImageUrlByFile,
  buildTitleImageUrl,
  registerCustomTitles,
  normalizeTitleCatalog,
  normalizeTitleImageFile,
  normalizeTitleId,
  resolveTitleById
} = require('../../../shared/titles.js');
const {
  normalizeBackgroundCatalog,
  registerCustomBackgrounds,
  buildBackgroundImageUrlByFile,
  normalizeBackgroundId,
  resolveBackgroundById,
  listBackgrounds,
  normalizeBackgroundMediaKey
} = require('../../../shared/backgrounds.js');

const RENAME_SOURCE_LABELS = {
  admin: '管理员调整',
  manual: '会员修改',
  system: '系统同步'
};

const RARITY_LABELS = {
  c: 'C',
  b: 'B',
  a: 'A',
  s: 'S',
  ss: 'SS',
  sss: 'SSS'
};

const RARITY_ORDER = ['c', 'b', 'a', 's', 'ss', 'sss'];

const AVATAR_GENDER_LABELS = {
  male: '男',
  female: '女'
};

const AVATAR_GENDER_OPTIONS = [
  { value: 'male', label: '男修' },
  { value: 'female', label: '女修' }
];

const AVATAR_RARITY_OPTIONS = RARITY_ORDER.map((value) => ({
  value,
  label: RARITY_LABELS[value] || value.toUpperCase()
}));

const DEFAULT_AVATAR_FORM = { name: '', gender: 'male', rarity: 'c', file: '' };

const AVATAR_RARITY_INDEX_MAP = RARITY_ORDER.reduce((acc, value, index) => {
  acc[value] = index;
  return acc;
}, {});

function normalizePotentialAvatarId(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

function isLikelyCustomAvatarId(id) {
  if (!id) {
    return false;
  }
  return id.includes('-custom-') || id.startsWith('custom-');
}

function normalizeAvatarUnlocks(unlocks = []) {
  const normalized = normalizeAvatarUnlocksStrict(unlocks);
  const seen = new Set(normalized);
  (Array.isArray(unlocks) ? unlocks : []).forEach((value) => {
    const id = normalizePotentialAvatarId(value);
    if (!id || seen.has(id)) {
      return;
    }
    if (isLikelyCustomAvatarId(id)) {
      normalized.push(id);
      seen.add(id);
    }
  });
  return normalized;
}

function buildFallbackAvatarUnlockEntry(id) {
  const normalizedId = normalizePotentialAvatarId(id);
  if (!normalizedId || !isLikelyCustomAvatarId(normalizedId)) {
    return null;
  }
  const segments = normalizedId.split('-');
  const gender = segments[0] || '';
  const rarity = segments[1] || '';
  const rest = segments.slice(2).join('-');
  const rarityLabel = RARITY_LABELS[rarity] || rarity.toUpperCase();
  const nameSegments = [];
  if (AVATAR_GENDER_LABELS[gender]) {
    nameSegments.push(AVATAR_GENDER_LABELS[gender]);
  }
  if (rarityLabel) {
    nameSegments.push(rarityLabel);
  }
  if (rest) {
    nameSegments.push(rest.toUpperCase());
  }
  let preview = buildAvatarUrlById(normalizedId);
  let normalizedFile = '';
  if (!preview) {
    const fallbackFile = normalizeAvatarFileName(rest);
    if (fallbackFile) {
      normalizedFile = fallbackFile;
      preview = buildAvatarUrlByFile(fallbackFile);
    }
  }
  if (!normalizedFile) {
    normalizedFile = normalizeAvatarFileName(rest || normalizedId);
  }
  const name = nameSegments.length ? nameSegments.join(' · ') : normalizedId;
  return {
    id: normalizedId,
    name,
    preview,
    rarity,
    rarityLabel,
    gender,
    genderLabel: AVATAR_GENDER_LABELS[gender] || '',
    file: normalizedFile,
    isFallback: true
  };
}

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
      const icon = buildEquipmentIconPaths(item);
      return {
        slot: slot.slot,
        slotLabel: slot.slotLabel || '',
        inventoryId: item.inventoryId || item.itemId || '',
        itemId: item.itemId || '',
        name: item.name || '',
        qualityLabel: item.qualityLabel || '',
        qualityColor: item.qualityColor || '#a5adb8',
        refine: typeof item.refine === 'number' ? item.refine : 0,
        iconUrl: item.iconUrl || icon.iconUrl,
        iconFallbackUrl: item.iconFallbackUrl || icon.iconFallbackUrl
      };
    })
    .filter((slot) => !!slot && slot.name);
}

function formatEquipmentInventory(profile) {
  if (!profile || !profile.equipment || !Array.isArray(profile.equipment.inventory)) {
    return [];
  }
  return profile.equipment.inventory.map((item) => {
    const icon = buildEquipmentIconPaths(item);
    return {
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
      favorite: !!item.favorite,
      iconUrl: item.iconUrl || icon.iconUrl,
      iconFallbackUrl: item.iconFallbackUrl || icon.iconFallbackUrl
    };
  });
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

function buildSecretRealmProgress(profile) {
  if (!profile || typeof profile !== 'object') {
    return {
      highestUnlockedFloor: 1,
      clearedCount: 0,
      totalFloors: 0,
      nextFloorId: ''
    };
  }
  const secretRealm =
    profile.secretRealm && typeof profile.secretRealm === 'object' ? profile.secretRealm : {};
  const highest = Number(secretRealm.highestUnlockedFloor || secretRealm.highestFloor || 0);
  const cleared = Number(secretRealm.clearedCount || 0);
  const total = Number(secretRealm.totalFloors || 0);
  return {
    highestUnlockedFloor: Number.isFinite(highest) && highest > 0 ? Math.floor(highest) : 1,
    clearedCount: Number.isFinite(cleared) && cleared >= 0 ? Math.floor(cleared) : 0,
    totalFloors: Number.isFinite(total) && total >= 0 ? Math.floor(total) : 0,
    nextFloorId: typeof secretRealm.nextFloorId === 'string' ? secretRealm.nextFloorId : ''
  };
}

function buildSecretRealmDraft(progress, previousDraft = {}) {
  const highest = progress && progress.highestUnlockedFloor ? progress.highestUnlockedFloor : '';
  const autoComplete =
    previousDraft && typeof previousDraft.autoComplete === 'boolean'
      ? previousDraft.autoComplete
      : true;
  return {
    highestUnlockedFloor: highest ? String(highest) : '',
    autoComplete
  };
}

function parseSecretRealmFloorInput(value) {
  if (typeof value !== 'string') {
    if (value == null) {
      return null;
    }
    try {
      value = String(value);
    } catch (error) {
      return null;
    }
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.max(1, Math.floor(numeric));
}

function buildAvatarOptionGroups(unlocks = []) {
  const unlockSet = new Set(normalizeAvatarUnlocks(unlocks));
  const avatars = listAllAvatars();
  const groups = [
    { gender: 'male', label: '男修', options: [] },
    { gender: 'female', label: '女修', options: [] }
  ];
  const groupMap = groups.reduce((acc, group) => {
    acc[group.gender] = group;
    return acc;
  }, {});
  avatars.forEach((avatar) => {
    const group = groupMap[avatar.gender];
    if (!group) {
      return;
    }
    group.options.push({
      id: avatar.id,
      label: avatar.name,
      disabled: avatar.rarity === 'c',
      checked: avatar.rarity === 'c' || unlockSet.has(avatar.id),
      url: avatar.url,
      rarity: avatar.rarity,
      rarityLabel: RARITY_LABELS[avatar.rarity] || avatar.rarity.toUpperCase(),
      genderLabel: AVATAR_GENDER_LABELS[avatar.gender] || '未知',
      attributeBonus: avatar.attributeBonus || 0
    });
  });
  return groups;
}

function calculateAvatarAttributeBonus(unlocks = []) {
  const unlockList = normalizeAvatarUnlocks(unlocks);
  if (!unlockList.length) {
    return 0;
  }
  const avatars = listAllAvatars();
  const avatarMap = new Map(avatars.map((avatar) => [avatar.id, avatar]));
  return unlockList.reduce((total, id) => {
    const avatar = avatarMap.get(id);
    if (avatar && avatar.attributeBonus) {
      return total + avatar.attributeBonus;
    }
    return total;
  }, 0);
}

function areUnlockListsEqual(a = [], b = []) {
  const listA = normalizeAvatarUnlocks(a);
  const listB = normalizeAvatarUnlocks(b);
  if (listA.length !== listB.length) {
    return false;
  }
  const setB = new Set(listB);
  return listA.every((id) => setB.has(id));
}

function buildAvatarPermissionSummary(unlocks = []) {
  const list = normalizeAvatarUnlocks(unlocks);
  if (!list.length) {
    return '当前仅开放默认头像';
  }
  const bonus = calculateAvatarAttributeBonus(list);
  const segments = [`已解锁头像：${list.length} 个`];
  if (bonus > 0) {
    segments.push(`额外属性点：+${bonus}`);
  }
  return segments.join(' · ');
}

function buildAvatarManagerEntries(catalog = []) {
  const normalized = normalizeAvatarCatalog(catalog);
  registerCustomAvatars(normalized);
  return normalized.map((entry) => ({
    ...entry,
    preview: buildAvatarUrlById(entry.id),
    rarityLabel: RARITY_LABELS[entry.rarity] || entry.rarity.toUpperCase(),
    genderLabel: AVATAR_GENDER_LABELS[entry.gender] || '未知',
    attributeBonus: entry.attributeBonus || 0
  }));
}

function buildAvatarManagerUnlockedEntries(entries = [], unlocks = []) {
  const normalizedEntries = normalizeAvatarCatalog(entries);
  const entryMap = new Map(normalizedEntries.map((entry) => [entry.id, entry]));
  const avatarMap = new Map(listAllAvatars().map((avatar) => [avatar.id, avatar]));
  const seen = new Set();
  return normalizeAvatarUnlocks(unlocks)
    .map((id) => {
      if (!id || seen.has(id)) {
        return null;
      }
      seen.add(id);
      if (entryMap.has(id)) {
        const entry = entryMap.get(id);
        return {
          id: entry.id,
          name: entry.name,
          preview: buildAvatarUrlById(entry.id),
          rarityLabel: RARITY_LABELS[entry.rarity] || entry.rarity.toUpperCase(),
          source: 'customCatalog',
          isCustom: true
        };
      }
      if (avatarMap.has(id)) {
        const avatar = avatarMap.get(id);
        return {
          id: avatar.id,
          name: avatar.name,
          preview: avatar.url,
          rarityLabel: RARITY_LABELS[avatar.rarity] || avatar.rarity.toUpperCase(),
          source: 'builtin',
          isCustom: false
        };
      }
      const fallback = buildFallbackAvatarUnlockEntry(id);
      if (!fallback) {
        return null;
      }
      return {
        id: fallback.id,
        name: fallback.name,
        preview: fallback.preview,
        rarityLabel: fallback.rarityLabel,
        source: 'customFallback',
        isCustom: true
      };
    })
    .filter(Boolean);
}

function normalizeTitleUnlocks(unlocks = []) {
  if (!Array.isArray(unlocks)) {
    return [];
  }
  const seen = new Set();
  const result = [];
  unlocks.forEach((value) => {
    const id = normalizeTitleId(value);
    if (!id || seen.has(id)) {
      return;
    }
    seen.add(id);
    result.push(id);
  });
  return result;
}

function buildTitleManagerEntries(catalog = []) {
  const normalized = normalizeTitleCatalog(catalog);
  return normalized.map((entry) => ({
    id: entry.id,
    name: entry.name,
    imageFile: entry.imageFile,
    preview: buildTitleImageUrlByFile(entry.imageFile || entry.id)
  }));
}

function normalizeBackgroundUnlocks(unlocks = []) {
  if (!Array.isArray(unlocks)) {
    return [];
  }
  const seen = new Set();
  const result = [];
  unlocks.forEach((value) => {
    const id = normalizeBackgroundId(value);
    if (!id || seen.has(id)) {
      return;
    }
    seen.add(id);
    result.push(id);
  });
  return result;
}

function buildBackgroundManagerEntries(catalog = []) {
  const normalized = normalizeBackgroundCatalog(catalog);
  return normalized.map((entry) => ({
    id: entry.id,
    name: entry.name,
    mediaKey: entry.mediaKey,
    preview: buildBackgroundImageUrlByFile(entry.mediaKey || entry.id)
  }));
}

function ensureCustomBackgroundsUnlocked(entries = [], unlocks = []) {
  const normalizedUnlocks = normalizeBackgroundUnlocks(unlocks);
  const unlockSet = new Set(normalizedUnlocks);
  let changed = false;
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!entry || !entry.id || unlockSet.has(entry.id)) {
      return;
    }
    unlockSet.add(entry.id);
    normalizedUnlocks.push(entry.id);
    changed = true;
  });
  return changed ? normalizeBackgroundUnlocks(normalizedUnlocks) : normalizedUnlocks;
}

function buildBackgroundSummaryFromEntries(entries = [], unlocks = []) {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
  const unlockList = ensureCustomBackgroundsUnlocked(list, unlocks);
  if (!list.length) {
    if (unlockList.length) {
      return `基础背景已解锁 ${unlockList.length} 个`;
    }
    return '暂无自定义背景';
  }
  const customIdSet = new Set(list.map((entry) => entry && entry.id).filter(Boolean));
  const builtinUnlockedCount = unlockList.filter((id) => id && !customIdSet.has(id)).length;
  const segments = [`已添加 ${list.length} 个背景（自动解锁）`];
  if (builtinUnlockedCount) {
    segments.push(`基础已解锁 ${builtinUnlockedCount} 个`);
  }
  return segments.join(' · ');
}

function buildBackgroundManagerUnlockedEntries(entries = [], unlocks = []) {
  const unlockList = ensureCustomBackgroundsUnlocked(entries, unlocks);
  if (!unlockList.length) {
    return [];
  }
  const customMap = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!entry || !entry.id) {
      return;
    }
    const preview = entry.preview || buildBackgroundImageUrlByFile(entry.mediaKey || entry.id);
    customMap.set(entry.id, {
      ...entry,
      preview
    });
  });
  const baseBackgrounds = listBackgrounds();
  const baseMap = new Map((Array.isArray(baseBackgrounds) ? baseBackgrounds : []).map((item) => [item.id, item]));
  const seen = new Set();
  return unlockList
    .map((id) => {
      if (!id || seen.has(id)) {
        return null;
      }
      seen.add(id);
      if (customMap.has(id)) {
        return customMap.get(id);
      }
      const resolved = resolveBackgroundById(id) || baseMap.get(id);
      if (!resolved) {
        return null;
      }
      return {
        id: resolved.id,
        name: resolved.name || resolved.id,
        preview: resolved.image || buildBackgroundImageUrlByFile(resolved.mediaKey || resolved.id)
      };
    })
    .filter(Boolean);
}

function ensureCustomTitlesUnlocked(entries = [], unlocks = []) {
  const normalizedUnlocks = normalizeTitleUnlocks(unlocks);
  const unlockSet = new Set(normalizedUnlocks);
  let changed = false;
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!entry || !entry.id || unlockSet.has(entry.id)) {
      return;
    }
    unlockSet.add(entry.id);
    normalizedUnlocks.push(entry.id);
    changed = true;
  });
  return changed ? normalizeTitleUnlocks(normalizedUnlocks) : normalizedUnlocks;
}

function buildTitleSummaryFromEntries(entries = [], unlocks = []) {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
  const unlockList = ensureCustomTitlesUnlocked(list, unlocks);
  if (!list.length) {
    if (unlockList.length) {
      return `基础称号已解锁 ${unlockList.length} 个`;
    }
    return '暂无自定义称号';
  }
  const customIdSet = new Set(list.map((entry) => entry && entry.id).filter(Boolean));
  const builtinUnlockedCount = unlockList.filter((id) => id && !customIdSet.has(id)).length;
  const segments = [`已添加 ${list.length} 个称号（自动解锁）`];
  if (builtinUnlockedCount) {
    segments.push(`基础已解锁 ${builtinUnlockedCount} 个`);
  }
  return segments.join(' · ');
}

function buildTitleManagerUnlockedEntries(entries = [], unlocks = []) {
  const unlockList = ensureCustomTitlesUnlocked(entries, unlocks);
  if (!unlockList.length) {
    return [];
  }
  const customMap = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!entry || !entry.id) {
      return;
    }
    const preview = entry.preview || buildTitleImageUrlByFile(entry.imageFile || entry.id);
    customMap.set(entry.id, {
      ...entry,
      preview
    });
  });
  const seen = new Set();
  return unlockList
    .map((id) => {
      if (!id || seen.has(id)) {
        return null;
      }
      seen.add(id);
      if (customMap.has(id)) {
        return customMap.get(id);
      }
      const resolved = resolveTitleById(id);
      if (!resolved) {
        return null;
      }
      return {
        id: resolved.id,
        name: resolved.name,
        preview: resolved.image || buildTitleImageUrl(resolved.id)
      };
    })
    .filter(Boolean);
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

function getCurrentAdminId() {
  try {
    if (typeof getApp === 'function') {
      const app = getApp();
      if (app && app.globalData && app.globalData.memberInfo) {
        return app.globalData.memberInfo._id || '';
      }
    }
  } catch (error) {
    console.error('[admin:member] resolve current admin id failed', error);
  }
  return '';
}

Page({
  data: {
    memberId: '',
    currentAdminId: '',
    loading: true,
    saving: false,
    deleting: false,
    proxyLoginAvailable: false,
    proxyLoginLoading: false,
    member: null,
    levels: [],
    levelIndex: 0,
    currentLevelName: '',
    roleOptions: [
      { value: 'member', label: '会员', checked: false, disabled: true },
      { value: 'admin', label: '管理员', checked: false },
      { value: 'developer', label: '开发', checked: false },
      { value: 'test', label: '测试', checked: false }
    ],
    avatarOptionGroups: buildAvatarOptionGroups([]),
    avatarPermissionSummary: buildAvatarPermissionSummary([]),
    avatarPermissionDialogVisible: false,
    avatarDialogSelection: [],
    avatarDialogOptionGroups: buildAvatarOptionGroups([]),
    avatarAttributeBonus: 0,
    avatarGenderOptions: AVATAR_GENDER_OPTIONS,
    avatarRarityOptions: AVATAR_RARITY_OPTIONS,
    avatarRarityIndexMap: AVATAR_RARITY_INDEX_MAP,
    rarityLabels: RARITY_LABELS,
    avatarManagerSaving: false,
    avatarManagerEntries: [],
    avatarManagerUnlocks: [],
    avatarManagerInitialUnlocks: [],
    avatarManagerUnlockedEntries: [],
    avatarManagerForm: { ...DEFAULT_AVATAR_FORM },
    avatarManagerDirty: false,
    form: {
      nickName: '',
      realName: '',
      mobile: '',
      experience: '',
      cashBalance: '',
      stoneBalance: '',
      levelId: '',
      roles: [],
      renameCredits: '',
      respecAvailable: '',
      skillDrawCredits: '',
      roomUsageCount: '',
      storageUpgradeAvailable: '0',
      storageUpgradeLimit: '',
      avatarUnlocks: []
    },
    rechargeVisible: false,
    rechargeAmount: '',
    renameHistory: [],
    pveProfile: null,
    pveProfileLoading: false,
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
    updatingEquipment: false,
    secretRealmProfile: { highestUnlockedFloor: 1, clearedCount: 0, totalFloors: 0, nextFloorId: '' },
    secretRealmDraft: { highestUnlockedFloor: '', autoComplete: true },
    secretRealmSaving: false,
    secretRealmResetting: false,
    secretRealmSummary: '',
    secretRealmError: '',
    titleSummary: '暂无自定义称号',
    backgroundSummary: '暂无自定义背景',
    titleManagerVisible: false,
    titleManagerSaving: false,
    titleManagerEntries: [],
    titleManagerUnlocks: [],
    titleManagerUnlockedEntries: [],
    titleManagerForm: { name: '', file: '' },
    titleManagerDirty: false,
    backgroundManagerVisible: false,
    backgroundManagerSaving: false,
    backgroundManagerEntries: [],
    backgroundManagerUnlocks: [],
    backgroundManagerUnlockedEntries: [],
    backgroundManagerForm: { name: '', file: '' },
    backgroundManagerDirty: false
  },

  onLoad(options) {
    const { id } = options;
    if (!id) {
      wx.showToast({ title: '缺少会员编号', icon: 'none' });
      return;
    }
    this.setData({ memberId: id, currentAdminId: getCurrentAdminId() });
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
        ? res.items.map((item) => {
            const icon = buildEquipmentIconPaths(item);
            const entry = { ...item, ...icon };
            return { ...entry, label: buildCatalogLabel(entry) };
          })
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

  resolveProxyLoginAvailability(member) {
    if (!member || !member._id) {
      return false;
    }
    try {
      if (typeof getApp === 'function') {
        const appInstance = getApp();
        if (
          appInstance &&
          appInstance.globalData &&
          appInstance.globalData.proxySession &&
          appInstance.globalData.proxySession.active !== false
        ) {
          return false;
        }
      }
    } catch (error) {
      console.error('[admin:member] resolve proxy availability failed', error);
    }
    if (this.data.currentAdminId && member._id === this.data.currentAdminId) {
      return false;
    }
    const roles = ensureMemberRole(member.roles);
    if (roles.includes('admin') || roles.includes('developer')) {
      return false;
    }
    return true;
  },

  applyDetail(detail) {
    if (!detail || !detail.member) return;
    const { member, levels = [] } = detail;
    const titleUnlocks = normalizeTitleUnlocks(member.titleUnlocks);
    const titleCatalog = normalizeTitleCatalog(member.titleCatalog);
    const titleEntries = buildTitleManagerEntries(titleCatalog);
    const ensuredTitleUnlocks = ensureCustomTitlesUnlocked(titleEntries, titleUnlocks);
    member.titleUnlocks = ensuredTitleUnlocks;
    member.titleCatalog = titleCatalog;
    registerCustomTitles(titleCatalog);
    const titleSummary = buildTitleSummaryFromEntries(titleEntries, ensuredTitleUnlocks);
    const backgroundUnlocks = normalizeBackgroundUnlocks(member.backgroundUnlocks);
    const backgroundCatalog = normalizeBackgroundCatalog(member.backgroundCatalog);
    const backgroundEntries = buildBackgroundManagerEntries(backgroundCatalog);
    const ensuredBackgroundUnlocks = ensureCustomBackgroundsUnlocked(backgroundEntries, backgroundUnlocks);
    member.backgroundUnlocks = ensuredBackgroundUnlocks;
    member.backgroundCatalog = backgroundCatalog;
    registerCustomBackgrounds(backgroundCatalog);
    const backgroundSummary = buildBackgroundSummaryFromEntries(backgroundEntries, ensuredBackgroundUnlocks);
    const existingProfile = this.data.pveProfile || null;
    const hasNewProfile = !!(detail && detail.pveProfile);
    const profileToApply = hasNewProfile ? detail.pveProfile : existingProfile;
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
    const serverAvatarCatalog = Array.isArray(member.avatarCatalog) ? member.avatarCatalog : [];
    const serverAvatarIdSet = new Set(
      serverAvatarCatalog
        .map((entry) => (entry && typeof entry.id === 'string' ? entry.id.trim().toLowerCase() : ''))
        .filter(Boolean)
    );
    const unlockIdSet = new Set(
      (Array.isArray(member.avatarUnlocks) ? member.avatarUnlocks : [])
        .map((id) => (typeof id === 'string' ? id.trim().toLowerCase() : ''))
        .filter(Boolean)
    );
    const previousAvatarEntries = Array.isArray(this.data.avatarManagerEntries)
      ? this.data.avatarManagerEntries
      : [];
    const supplementalAvatarCatalog = previousAvatarEntries
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }
        const normalizedId = typeof entry.id === 'string' ? entry.id.trim().toLowerCase() : '';
        if (!normalizedId || serverAvatarIdSet.has(normalizedId)) {
          return null;
        }
        if (!unlockIdSet.has(normalizedId) && !normalizedId.includes('-custom-')) {
          return null;
        }
        return {
          id: normalizedId,
          name: entry.name,
          gender: entry.gender,
          rarity: entry.rarity,
          file: entry.file || normalizedId,
          characterFile: entry.characterFile || entry.file || normalizedId
        };
      })
      .filter(Boolean);
    const mergedAvatarCatalog = normalizeAvatarCatalog(
      serverAvatarCatalog.concat(supplementalAvatarCatalog)
    );
    member.avatarCatalog = mergedAvatarCatalog;
    const avatarEntries = buildAvatarManagerEntries(member.avatarCatalog);
    const avatarUnlocks = normalizeAvatarUnlocks(member.avatarUnlocks);
    member.avatarUnlocks = avatarUnlocks;
    const avatarManagerUnlockedEntries = buildAvatarManagerUnlockedEntries(avatarEntries, avatarUnlocks);
    const avatarAttributeBonus = Number.isFinite(Number(member.avatarAttributeBonus))
      ? Math.max(0, Math.floor(Number(member.avatarAttributeBonus)))
      : calculateAvatarAttributeBonus(avatarUnlocks);
    const previousForm = this.data.form || {};
    this.setData({
      member,
      levels,
      levelIndex,
      currentLevelName: currentLevel.name || '',
      loading: false,
      form: {
        ...previousForm,
        nickName: member.nickName || '',
        realName: member.realName || '',
        mobile: member.mobile || '',
        experience: String(member.experience ?? 0),
        cashBalance: this.formatYuan(member.cashBalance ?? member.balance ?? 0),
        stoneBalance: String(member.stoneBalance ?? 0),
        levelId: member.levelId || currentLevel._id || '',
        roles,
        renameCredits: String(member.renameCredits ?? 0),
        respecAvailable: String(member.pveRespecAvailable ?? 0),
        skillDrawCredits: String(member.skillDrawCredits ?? 0),
        roomUsageCount: String(member.roomUsageCount ?? 0),
        storageUpgradeAvailable:
          typeof previousForm.storageUpgradeAvailable === 'string'
            ? previousForm.storageUpgradeAvailable
            : '0',
        storageUpgradeLimit:
          typeof previousForm.storageUpgradeLimit === 'string'
            ? previousForm.storageUpgradeLimit
            : '',
        avatarUnlocks: avatarUnlocks
      },
      roleOptions,
      renameHistory: formatRenameHistory(member.renameHistory),
      avatarOptionGroups: buildAvatarOptionGroups(avatarUnlocks),
      avatarPermissionSummary: buildAvatarPermissionSummary(avatarUnlocks),
      avatarDialogSelection: avatarUnlocks,
      avatarDialogOptionGroups: buildAvatarOptionGroups(avatarUnlocks),
      avatarAttributeBonus,
      avatarManagerEntries: avatarEntries,
      avatarManagerUnlocks: avatarUnlocks,
      avatarManagerInitialUnlocks: avatarUnlocks,
      avatarManagerUnlockedEntries: avatarManagerUnlockedEntries,
      avatarManagerForm: { ...DEFAULT_AVATAR_FORM },
      avatarManagerSaving: false,
      avatarManagerDirty: false,
      titleSummary,
      backgroundSummary,
      secretRealmSummary: '',
      secretRealmError: '',
      proxyLoginAvailable: this.resolveProxyLoginAvailability(member)
    });
    this.updatePveProfile(profileToApply, {
      skipSanitize: !hasNewProfile && !!existingProfile,
      overrideForm: hasNewProfile,
      resetFormStorage: !hasNewProfile && !existingProfile
    });
    if (!hasNewProfile) {
      this.loadMemberPveProfile(member._id, { silent: true });
    }
  },

  async loadMemberPveProfile(memberId, { silent = false, force = false } = {}) {
    const targetId = typeof memberId === 'string' && memberId ? memberId : this.data.memberId;
    if (!targetId) {
      return;
    }
    if (this.data.pveProfileLoading && !force) {
      return;
    }
    if (!silent || !this.data.pveProfileLoading) {
      this.setData({ pveProfileLoading: true });
    }
    try {
      const res = await PveService.adminInspectProfile(targetId);
      if (res && res.profile) {
        this.updatePveProfile(res.profile);
      }
    } catch (error) {
      console.error('[admin] load member pve profile failed', error);
    } finally {
      this.setData({ pveProfileLoading: false });
    }
  },

  updatePveProfile(profile, options = {}) {
    const skipSanitize = !!(options && options.skipSanitize);
    const sanitizedProfile = skipSanitize ? profile : sanitizeEquipmentProfile(profile);
    const hasProfile = !!(sanitizedProfile && sanitizedProfile.equipment);
    const secretRealmProgress = buildSecretRealmProgress(sanitizedProfile);
    const updates = {
      pveProfile: sanitizedProfile || null,
      equipmentProfileLoaded: hasProfile,
      secretRealmProfile: secretRealmProgress,
      secretRealmDraft: buildSecretRealmDraft(secretRealmProgress, this.data.secretRealmDraft)
    };
    if (hasProfile && options.overrideForm !== false) {
      const storage =
        sanitizedProfile &&
        sanitizedProfile.equipment &&
        typeof sanitizedProfile.equipment.storage === 'object'
          ? sanitizedProfile.equipment.storage
          : null;
      const storageMeta = storage && typeof storage.meta === 'object' ? storage.meta : null;
      const availableSource =
        storage && Object.prototype.hasOwnProperty.call(storage, 'upgradeAvailable')
          ? storage.upgradeAvailable
          : storageMeta && Object.prototype.hasOwnProperty.call(storageMeta, 'upgradeAvailable')
          ? storageMeta.upgradeAvailable
          : 0;
      const skills =
        sanitizedProfile && typeof sanitizedProfile.skills === 'object'
          ? sanitizedProfile.skills
          : null;
      const drawCredits = this.parseSkillDrawCredits(skills && skills.drawCredits);
      updates.form = {
        ...this.data.form,
        storageUpgradeAvailable: String(
          this.parseStorageUpgradeAvailable(availableSource)
        ),
        storageUpgradeLimit: this.resolveStorageUpgradeLimitInput(storage),
        skillDrawCredits: String(drawCredits)
      };
    } else if (!hasProfile && options.resetFormStorage) {
      updates.form = {
        ...this.data.form,
        storageUpgradeAvailable: '0',
        storageUpgradeLimit: ''
      };
    }
    this.setData(updates);
    this.applyEquipmentProfile(sanitizedProfile, { skipSanitize: true });
  },

  resolveStorageUpgradeLimitInput(storage) {
    if (!storage || typeof storage !== 'object') {
      return '';
    }
    const meta = storage.meta && typeof storage.meta === 'object' ? storage.meta : {};
    if (Object.prototype.hasOwnProperty.call(meta, 'upgradeLimit')) {
      const parsed = this.parseStorageUpgradeLimit(meta.upgradeLimit);
      return parsed === null ? '' : String(parsed);
    }
    if (Object.prototype.hasOwnProperty.call(storage, 'upgradeLimit')) {
      const parsed = this.parseStorageUpgradeLimit(storage.upgradeLimit);
      return parsed === null ? '' : String(parsed);
    }
    return '';
  },

  applyEquipmentProfile(profile, options = {}) {
    const sanitizedProfile =
      options && options.skipSanitize ? profile : sanitizeEquipmentProfile(profile);
    const hasProfile = !!(sanitizedProfile && sanitizedProfile.equipment);
    const equipmentSlots = hasProfile ? formatEquipmentSlots(sanitizedProfile) : [];
    const equipmentInventory = hasProfile ? formatEquipmentInventory(sanitizedProfile) : [];
    this.setData({
      equipmentSlots,
      equipmentInventory,
      equipmentProfileLoaded: hasProfile
    });
  },

  handleSecretRealmFieldChange(event) {
    const { field } = (event && event.currentTarget && event.currentTarget.dataset) || {};
    if (field !== 'highestUnlockedFloor') {
      return;
    }
    const value = event && event.detail ? event.detail.value : '';
    const inputValue = typeof value === 'string' ? value : String(value || '');
    this.setData({
      secretRealmDraft: { ...this.data.secretRealmDraft, highestUnlockedFloor: inputValue },
      secretRealmError: ''
    });
  },

  handleSecretRealmAutoCompleteChange(event) {
    const enabled = !!(event && event.detail && event.detail.value);
    this.setData({
      secretRealmDraft: { ...this.data.secretRealmDraft, autoComplete: enabled }
    });
  },

  async handleSecretRealmSave() {
    if (this.data.secretRealmSaving || this.data.secretRealmResetting) {
      return;
    }
    const memberId = this.data.memberId;
    if (!memberId) {
      wx.showToast({ title: '缺少会员编号', icon: 'none' });
      return;
    }
    const draft = this.data.secretRealmDraft || {};
    const parsed = parseSecretRealmFloorInput(draft.highestUnlockedFloor);
    if (parsed === null) {
      this.setData({ secretRealmError: '请输入有效的楼层数字' });
      wx.showToast({ title: '请输入有效楼层', icon: 'none' });
      return;
    }

    const totalFloors = Number(this.data.secretRealmProfile && this.data.secretRealmProfile.totalFloors);
    let targetFloor = parsed;
    if (Number.isFinite(totalFloors) && totalFloors > 0) {
      targetFloor = Math.min(totalFloors, targetFloor);
    }
    if (targetFloor < 1) {
      targetFloor = 1;
    }

    this.setData({ secretRealmSaving: true, secretRealmError: '', secretRealmSummary: '' });

    try {
      const res = await AdminService.updateSecretRealmProgress(memberId, {
        highestUnlockedFloor: targetFloor,
        autoComplete: draft.autoComplete !== false
      });
      if (res && res.profile) {
        this.updatePveProfile(res.profile, { overrideForm: false });
      }
      this.setData({
        secretRealmSaving: false,
        secretRealmSummary: `已调整至第${targetFloor}层`
      });
      wx.showToast({ title: '保存成功', icon: 'success' });
    } catch (error) {
      this.setData({
        secretRealmSaving: false,
        secretRealmError: error.errMsg || error.message || '保存失败，请稍后重试'
      });
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  async handleSecretRealmReset() {
    if (this.data.secretRealmResetting || this.data.secretRealmSaving) {
      return;
    }
    const memberId = this.data.memberId;
    if (!memberId) {
      wx.showToast({ title: '缺少会员编号', icon: 'none' });
      return;
    }
    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: '重置秘境进度',
        content: '确认将该会员的秘境进度恢复到初始状态？',
        confirmText: '立即重置',
        confirmColor: '#ef4444',
        cancelText: '取消',
        success: (res) => resolve(!!(res && res.confirm)),
        fail: () => resolve(false)
      });
    });
    if (!confirmed) {
      return;
    }

    this.setData({ secretRealmResetting: true, secretRealmError: '', secretRealmSummary: '' });

    try {
      const res = await AdminService.updateSecretRealmProgress(memberId, { reset: true });
      if (res && res.profile) {
        this.updatePveProfile(res.profile, { overrideForm: false });
      }
      this.setData({
        secretRealmResetting: false,
        secretRealmSummary: '已恢复至初始秘境进度'
      });
      wx.showToast({ title: '已重置', icon: 'success' });
    } catch (error) {
      this.setData({
        secretRealmResetting: false,
        secretRealmError: error.errMsg || error.message || '重置失败，请稍后重试'
      });
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  handleEquipmentIconError(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const fallback = typeof dataset.fallback === 'string' ? dataset.fallback : '';
    if (!fallback) {
      return;
    }
    const context = typeof dataset.context === 'string' ? dataset.context : '';
    const updates = {};
    if (context === 'slot') {
      const indexValue = typeof dataset.index === 'number' ? dataset.index : Number(dataset.index);
      const slots = Array.isArray(this.data.equipmentSlots) ? this.data.equipmentSlots.slice() : [];
      if (!Number.isFinite(indexValue) || indexValue < 0 || !slots[indexValue]) {
        return;
      }
      if (slots[indexValue].iconUrl === fallback) {
        return;
      }
      slots[indexValue] = { ...slots[indexValue], iconUrl: fallback };
      updates.equipmentSlots = slots;
    } else if (context === 'inventory') {
      const indexValue = typeof dataset.index === 'number' ? dataset.index : Number(dataset.index);
      const inventory = Array.isArray(this.data.equipmentInventory) ? this.data.equipmentInventory.slice() : [];
      if (!Number.isFinite(indexValue) || indexValue < 0 || !inventory[indexValue]) {
        return;
      }
      if (inventory[indexValue].iconUrl === fallback) {
        return;
      }
      inventory[indexValue] = { ...inventory[indexValue], iconUrl: fallback };
      updates.equipmentInventory = inventory;
    } else if (context === 'catalog') {
      const id = typeof dataset.id === 'string' ? dataset.id : dataset.id ? String(dataset.id) : '';
      if (!id) {
        return;
      }
      const catalog = Array.isArray(this.data.equipmentCatalog) ? this.data.equipmentCatalog.slice() : [];
      const filtered = Array.isArray(this.data.filteredEquipmentCatalog)
        ? this.data.filteredEquipmentCatalog.slice()
        : [];
      let changed = false;
      const catalogIndex = catalog.findIndex((item) => item.id === id);
      if (catalogIndex >= 0 && catalog[catalogIndex].iconUrl !== fallback) {
        catalog[catalogIndex] = { ...catalog[catalogIndex], iconUrl: fallback };
        changed = true;
      }
      const filteredIndex = filtered.findIndex((item) => item.id === id);
      if (filteredIndex >= 0 && filtered[filteredIndex].iconUrl !== fallback) {
        filtered[filteredIndex] = { ...filtered[filteredIndex], iconUrl: fallback };
        changed = true;
      }
      if (!changed) {
        return;
      }
      updates.equipmentCatalog = catalog;
      updates.filteredEquipmentCatalog = filtered;
    } else {
      return;
    }
    this.setData(updates);
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

  showAvatarPermissionDialog() {
    const member = this.data.member || {};
    const catalog = Array.isArray(member.avatarCatalog) ? member.avatarCatalog : [];
    const formUnlocks =
      this.data.form && Array.isArray(this.data.form.avatarUnlocks)
        ? this.data.form.avatarUnlocks
        : [];
    const sourceUnlocks = formUnlocks.length ? formUnlocks : member.avatarUnlocks;
    const unlocks = normalizeAvatarUnlocks(sourceUnlocks);
    this.commitAvatarManagerState({
      entries: catalog,
      unlocks,
      form: { ...DEFAULT_AVATAR_FORM },
      dirty: false,
      saving: false,
      initialUnlocks: unlocks
    });
    this.setData({
      avatarPermissionDialogVisible: true,
      avatarManagerForm: { ...DEFAULT_AVATAR_FORM },
      avatarManagerSaving: false
    });
  },

  hideAvatarPermissionDialog() {
    const member = this.data.member || {};
    const catalog = Array.isArray(member.avatarCatalog) ? member.avatarCatalog : [];
    const unlocks = normalizeAvatarUnlocks(member.avatarUnlocks);
    this.commitAvatarManagerState({
      entries: catalog,
      unlocks,
      form: { ...DEFAULT_AVATAR_FORM },
      dirty: false,
      saving: false,
      initialUnlocks: unlocks
    });
    this.setData({
      avatarPermissionDialogVisible: false,
      avatarManagerForm: { ...DEFAULT_AVATAR_FORM },
      avatarManagerSaving: false
    });
  },

  handleAvatarDialogChange(event) {
    const value = Array.isArray(event.detail.value) ? event.detail.value : [];
    const unlocks = normalizeAvatarUnlocks(value);
    const initial = normalizeAvatarUnlocks(this.data.avatarManagerInitialUnlocks);
    const changed = !areUnlockListsEqual(unlocks, initial);
    const dirty = changed || !!this.data.avatarManagerDirty;
    this.commitAvatarManagerState({ unlocks, dirty });
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
    await this.grantEquipmentToMember(itemId);
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
        this.updatePveProfile(res.profile, { overrideForm: false });
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
        this.updatePveProfile(res.profile, { overrideForm: false });
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
    const localAvatarCatalog = normalizeAvatarCatalog(this.data.avatarManagerEntries);
    const localAvatarUnlocks = normalizeAvatarUnlocks(this.data.form.avatarUnlocks);
    const wasAvatarManagerDirty = !!this.data.avatarManagerDirty;
    this.setData({ saving: true });
    try {
      const payload = {
        nickName: (this.data.form.nickName || '').trim(),
        realName: (this.data.form.realName || '').trim(),
        mobile: (this.data.form.mobile || '').trim(),
        experience: Number(this.data.form.experience || 0),
        cashBalance: this.parseYuanToFen(this.data.form.cashBalance),
        stoneBalance: Number(this.data.form.stoneBalance || 0),
        levelId: this.data.form.levelId,
        roles: ensureMemberRole(this.data.form.roles),
        renameCredits: this.parseRenameCredits(this.data.form.renameCredits),
        respecAvailable: this.parseRespecAvailable(this.data.form.respecAvailable),
        skillDrawCredits: this.parseSkillDrawCredits(this.data.form.skillDrawCredits),
        roomUsageCount: Number(this.data.form.roomUsageCount || 0),
        storageUpgradeAvailable: this.parseStorageUpgradeAvailable(
          this.data.form.storageUpgradeAvailable
        ),
        storageUpgradeLimit: this.parseStorageUpgradeLimit(this.data.form.storageUpgradeLimit),
        avatarCatalog: localAvatarCatalog,
        avatarUnlocks: localAvatarUnlocks
      };
      const detail = await AdminService.updateMember(this.data.memberId, payload);
      this.applyDetail(detail);
      const updatedMember = (detail && detail.member) || {};
      const serverCatalog = Array.isArray(updatedMember.avatarCatalog)
        ? normalizeAvatarCatalog(updatedMember.avatarCatalog)
        : [];
      const resolvedCatalog = serverCatalog.length ? serverCatalog : localAvatarCatalog;
      const serverUnlocks = Array.isArray(updatedMember.avatarUnlocks)
        ? normalizeAvatarUnlocks(updatedMember.avatarUnlocks)
        : [];
      const resolvedUnlocks = serverUnlocks.length ? serverUnlocks : localAvatarUnlocks;
      this.commitAvatarManagerState({
        entries: resolvedCatalog,
        unlocks: resolvedUnlocks,
        initialUnlocks: resolvedUnlocks
      });
      if (wasAvatarManagerDirty) {
        this.setData({ avatarManagerDirty: true });
      }
      wx.showToast({ title: '保存成功', icon: 'success' });
    } catch (error) {
      console.error('[admin:member:update]', error);
      wx.showToast({ title: error.errMsg || error.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  handleDeleteMember() {
    if (!this.data.memberId || this.data.deleting) {
      return;
    }
    const deletingSelf = this.data.member && this.data.member._id === this.data.currentAdminId;
    wx.showModal({
      title: '删除会员',
      content: deletingSelf
        ? '删除后您将失去管理员权限并需要重新登录，确定删除当前账号吗？'
        : '删除后将无法恢复该会员及其所有相关数据，确定继续吗？',
      confirmText: '删除',
      confirmColor: '#f43f5e',
      cancelText: '取消',
      success: (res) => {
        if (res && res.confirm) {
          this.confirmDeleteMember();
        }
      }
    });
  },

  async confirmDeleteMember() {
    if (!this.data.memberId || this.data.deleting) {
      return;
    }
    this.setData({ deleting: true });
    wx.showLoading({ title: '删除中', mask: true });
    try {
      const result = await AdminService.deleteMember(this.data.memberId);
      const selfDeleted = result && result.selfDeleted;
      wx.hideLoading();
      if (selfDeleted) {
        try {
          if (typeof getApp === 'function') {
            const app = getApp();
            if (app && app.globalData) {
              app.globalData.memberInfo = null;
            }
          }
        } catch (error) {
          console.error('[admin:member:self-delete] clear member info failed', error);
        }
        wx.showModal({
          title: '删除成功',
          content: '当前管理员账号已删除，请重新登录。',
          showCancel: false,
          success: () => {
            wx.reLaunch({ url: '/pages/index/index' });
          }
        });
        return;
      }
      wx.showToast({ title: '删除成功', icon: 'success' });
      setTimeout(() => {
        wx.navigateBack({
          delta: 1,
          fail: () => {
            wx.redirectTo({ url: '/pages/admin/members/index' });
          }
        });
      }, 500);
    } catch (error) {
      wx.hideLoading();
      console.error('[admin:member:delete]', error);
      wx.showToast({ title: error.errMsg || error.message || '删除失败', icon: 'none' });
    } finally {
      this.setData({ deleting: false });
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
        this.updatePveProfile(res.profile, { overrideForm: false });
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

  commitTitleManagerState(partial = {}) {
    const hasEntries = Object.prototype.hasOwnProperty.call(partial, 'entries');
    const hasUnlocks = Object.prototype.hasOwnProperty.call(partial, 'unlocks');
    const entries = hasEntries
      ? (Array.isArray(partial.entries) ? partial.entries : [])
      : Array.isArray(this.data.titleManagerEntries)
      ? this.data.titleManagerEntries
      : [];
    const unlocksSource = hasUnlocks ? partial.unlocks : this.data.titleManagerUnlocks;
    const unlocks = ensureCustomTitlesUnlocked(entries, unlocksSource);
    const updates = {
      titleManagerEntries: entries,
      titleManagerUnlocks: unlocks,
      titleManagerUnlockedEntries: buildTitleManagerUnlockedEntries(entries, unlocks)
    };
    if (partial.form) {
      updates.titleManagerForm = partial.form;
    }
    if (typeof partial.visible === 'boolean') {
      updates.titleManagerVisible = partial.visible;
    }
    if (typeof partial.dirty === 'boolean') {
      updates.titleManagerDirty = partial.dirty;
    }
    if (typeof partial.saving === 'boolean') {
      updates.titleManagerSaving = partial.saving;
    }
    if (partial.summary !== undefined) {
      updates.titleSummary = partial.summary;
    } else if (hasEntries || hasUnlocks) {
      updates.titleSummary = buildTitleSummaryFromEntries(entries, unlocks);
    }
    this.setData(updates);
  },

  commitBackgroundManagerState(partial = {}) {
    const hasEntries = Object.prototype.hasOwnProperty.call(partial, 'entries');
    const hasUnlocks = Object.prototype.hasOwnProperty.call(partial, 'unlocks');
    const entries = hasEntries
      ? (Array.isArray(partial.entries) ? partial.entries : [])
      : Array.isArray(this.data.backgroundManagerEntries)
      ? this.data.backgroundManagerEntries
      : [];
    const unlocksSource = hasUnlocks ? partial.unlocks : this.data.backgroundManagerUnlocks;
    const unlocks = ensureCustomBackgroundsUnlocked(entries, unlocksSource);
    const updates = {
      backgroundManagerEntries: entries,
      backgroundManagerUnlocks: unlocks,
      backgroundManagerUnlockedEntries: buildBackgroundManagerUnlockedEntries(entries, unlocks)
    };
    if (partial.form) {
      updates.backgroundManagerForm = partial.form;
    }
    if (typeof partial.visible === 'boolean') {
      updates.backgroundManagerVisible = partial.visible;
    }
    if (typeof partial.dirty === 'boolean') {
      updates.backgroundManagerDirty = partial.dirty;
    }
    if (typeof partial.saving === 'boolean') {
      updates.backgroundManagerSaving = partial.saving;
    }
    if (partial.summary !== undefined) {
      updates.backgroundSummary = partial.summary;
    } else if (hasEntries || hasUnlocks) {
      updates.backgroundSummary = buildBackgroundSummaryFromEntries(entries, unlocks);
    }
    this.setData(updates);
  },

  commitAvatarManagerState(partial = {}) {
    const hasEntries = Object.prototype.hasOwnProperty.call(partial, 'entries');
    const hasUnlocks = Object.prototype.hasOwnProperty.call(partial, 'unlocks');
    const baseEntries = hasEntries
      ? (Array.isArray(partial.entries) ? partial.entries : [])
      : Array.isArray(this.data.avatarManagerEntries)
      ? this.data.avatarManagerEntries
      : [];
    const normalizedCatalog = normalizeAvatarCatalog(baseEntries);
    const entries = buildAvatarManagerEntries(normalizedCatalog);
    const unlocksSource = hasUnlocks ? partial.unlocks : this.data.avatarManagerUnlocks;
    const unlocks = normalizeAvatarUnlocks(unlocksSource);
    entries.forEach((entry) => {
      if (!unlocks.includes(entry.id)) {
        unlocks.push(entry.id);
      }
    });
    const updates = {
      avatarManagerEntries: entries,
      avatarManagerUnlocks: unlocks,
      avatarManagerUnlockedEntries: buildAvatarManagerUnlockedEntries(entries, unlocks),
      avatarOptionGroups: buildAvatarOptionGroups(unlocks),
      avatarPermissionSummary: buildAvatarPermissionSummary(unlocks),
      avatarDialogSelection: unlocks,
      avatarDialogOptionGroups: buildAvatarOptionGroups(unlocks),
      avatarAttributeBonus: calculateAvatarAttributeBonus(unlocks),
      'form.avatarUnlocks': unlocks
    };
    if (partial.form) {
      updates.avatarManagerForm = partial.form;
    }
    if (typeof partial.dirty === 'boolean') {
      updates.avatarManagerDirty = partial.dirty;
    }
    if (typeof partial.saving === 'boolean') {
      updates.avatarManagerSaving = partial.saving;
    }
    if (Object.prototype.hasOwnProperty.call(partial, 'initialUnlocks')) {
      updates.avatarManagerInitialUnlocks = normalizeAvatarUnlocks(partial.initialUnlocks);
    }
    this.setData(updates);
  },

  openTitleManagerDialog() {
    const member = this.data.member || {};
    const catalog = Array.isArray(member.titleCatalog) ? member.titleCatalog : [];
    const entries = buildTitleManagerEntries(catalog);
    const unlocks = ensureCustomTitlesUnlocked(entries, member.titleUnlocks);
    registerCustomTitles(catalog);
    this.commitTitleManagerState({
      visible: true,
      entries,
      unlocks,
      form: { name: '', file: '' },
      dirty: false,
      saving: false
    });
  },

  handleTitleManagerInput(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const field = dataset.field;
    if (!field) {
      return;
    }
    const value = event && event.detail && typeof event.detail.value === 'string' ? event.detail.value : '';
    this.setData({
      titleManagerForm: {
        ...this.data.titleManagerForm,
        [field]: value
      }
    });
  },

  handleTitleManagerAdd() {
    const form = this.data.titleManagerForm || {};
    const name = typeof form.name === 'string' ? form.name.trim() : '';
    if (!name) {
      wx.showToast({ title: '请输入称号名称', icon: 'none' });
      return;
    }
    const fileInput = typeof form.file === 'string' ? form.file.trim() : '';
    const imageFile = normalizeTitleImageFile(fileInput || name);
    if (!imageFile) {
      wx.showToast({ title: '请输入文件名', icon: 'none' });
      return;
    }
    const existing = Array.isArray(this.data.titleManagerEntries) ? this.data.titleManagerEntries : [];
    const baseList = existing.map((entry) => ({ id: entry.id, name: entry.name, imageFile: entry.imageFile }));
    const appended = normalizeTitleCatalog(baseList.concat([{ name, imageFile }]));
    if (!appended.length) {
      wx.showToast({ title: '添加失败，请重试', icon: 'none' });
      return;
    }
    const entries = buildTitleManagerEntries(appended);
    const newEntry = entries[entries.length - 1];
    const unlocks = ensureCustomTitlesUnlocked(entries, this.data.titleManagerUnlocks);
    if (newEntry && newEntry.id && !unlocks.includes(newEntry.id)) {
      unlocks.push(newEntry.id);
    }
    registerCustomTitles(appended);
    this.commitTitleManagerState({
      entries,
      unlocks,
      form: { name: '', file: '' },
      dirty: true
    });
  },

  handleTitleManagerRemove(event) {
    const id = event && event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset.id : '';
    const targetId = normalizeTitleId(id);
    if (!targetId) {
      return;
    }
    const existing = Array.isArray(this.data.titleManagerEntries) ? this.data.titleManagerEntries : [];
    const filtered = existing.filter((entry) => entry && entry.id !== targetId);
    const normalized = normalizeTitleCatalog(filtered);
    const entries = buildTitleManagerEntries(normalized);
    const unlocks = normalizeTitleUnlocks(this.data.titleManagerUnlocks).filter((value) => value !== targetId);
    registerCustomTitles(normalized);
    this.commitTitleManagerState({ entries, unlocks, dirty: true });
  },

  handleCloseTitleManager() {
    if (this.data.titleManagerSaving) {
      return;
    }
    const member = this.data.member || {};
    const catalog = Array.isArray(member.titleCatalog) ? member.titleCatalog : [];
    const entries = buildTitleManagerEntries(catalog);
    const unlocks = ensureCustomTitlesUnlocked(entries, member.titleUnlocks);
    registerCustomTitles(catalog);
    this.commitTitleManagerState({
      visible: false,
      entries,
      unlocks,
      form: { name: '', file: '' },
      dirty: false
    });
  },

  async handleTitleManagerSave() {
    if (this.data.titleManagerSaving) {
      return;
    }
    const memberId = this.data.memberId;
    if (!memberId) {
      wx.showToast({ title: '缺少会员编号', icon: 'none' });
      return;
    }
    const catalog = normalizeTitleCatalog(this.data.titleManagerEntries);
    const entries = buildTitleManagerEntries(catalog);
    const unlocks = ensureCustomTitlesUnlocked(entries, this.data.titleManagerUnlocks);
    this.commitTitleManagerState({ saving: true });
    try {
      const detail = await AdminService.updateMember(memberId, {
        titleCatalog: catalog,
        titleUnlocks: unlocks
      });
      this.applyDetail(detail);
      const updatedMember = this.data.member || {};
      const savedCatalog = Array.isArray(updatedMember.titleCatalog) ? updatedMember.titleCatalog : [];
      const savedEntries = buildTitleManagerEntries(savedCatalog);
      const savedUnlocks = ensureCustomTitlesUnlocked(savedEntries, updatedMember.titleUnlocks);
      this.commitTitleManagerState({
        visible: false,
        saving: false,
        dirty: false,
        entries: savedEntries,
        unlocks: savedUnlocks,
        form: { name: '', file: '' }
      });
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (error) {
      console.error('[admin] save titles failed', error);
      this.commitTitleManagerState({ saving: false });
      wx.showToast({ title: error.errMsg || error.message || '保存失败', icon: 'none' });
    }
  },

  openBackgroundManagerDialog() {
    const member = this.data.member || {};
    const catalog = Array.isArray(member.backgroundCatalog) ? member.backgroundCatalog : [];
    const entries = buildBackgroundManagerEntries(catalog);
    const unlocks = ensureCustomBackgroundsUnlocked(entries, member.backgroundUnlocks);
    registerCustomBackgrounds(catalog);
    this.commitBackgroundManagerState({
      visible: true,
      entries,
      unlocks,
      form: { name: '', file: '' },
      dirty: false,
      saving: false
    });
  },

  handleAvatarManagerInput(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const field = dataset.field;
    if (!field) {
      return;
    }
    const value = event && event.detail && typeof event.detail.value === 'string' ? event.detail.value : '';
    this.setData({
      avatarManagerForm: {
        ...this.data.avatarManagerForm,
        [field]: value
      }
    });
  },

  handleAvatarManagerPickerChange(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const field = dataset.field;
    if (!field) {
      return;
    }
    const index = Number(event && event.detail && event.detail.value);
    if (!Number.isFinite(index) || index < 0) {
      return;
    }
    const options = field === 'gender' ? AVATAR_GENDER_OPTIONS : AVATAR_RARITY_OPTIONS;
    const option = options[index];
    if (!option) {
      return;
    }
    this.setData({
      avatarManagerForm: {
        ...this.data.avatarManagerForm,
        [field]: option.value
      }
    });
  },

  handleAvatarManagerAdd() {
    const form = this.data.avatarManagerForm || {};
    const name = typeof form.name === 'string' ? form.name.trim() : '';
    if (!name) {
      wx.showToast({ title: '请输入头像名称', icon: 'none' });
      return;
    }
    const fileInput = typeof form.file === 'string' ? form.file.trim() : '';
    const file = fileInput || name;
    const gender = form.gender === 'female' ? 'female' : 'male';
    const rarity = RARITY_ORDER.includes(form.rarity) ? form.rarity : 'c';
    const existing = normalizeAvatarCatalog(this.data.avatarManagerEntries);
    const appended = normalizeAvatarCatalog(existing.concat([{ name, file, gender, rarity }]));
    if (!appended.length) {
      wx.showToast({ title: '添加失败，请重试', icon: 'none' });
      return;
    }
    const entries = buildAvatarManagerEntries(appended);
    const unlocks = normalizeAvatarUnlocks(this.data.avatarManagerUnlocks).slice();
    const newest = entries[entries.length - 1];
    if (newest && newest.id && !unlocks.includes(newest.id)) {
      unlocks.push(newest.id);
    }
    this.commitAvatarManagerState({
      entries,
      unlocks,
      form: { ...DEFAULT_AVATAR_FORM, gender, rarity },
      dirty: true
    });
  },

  handleAvatarManagerRemove(event) {
    if (this.data.avatarManagerSaving) {
      return;
    }
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const id = typeof dataset.id === 'string' ? dataset.id : '';
    if (!id) {
      return;
    }
    const displayName = typeof dataset.name === 'string' && dataset.name ? dataset.name : '';
    wx.showModal({
      title: '删除自定义头像',
      content: `确定要删除“${displayName || id}”吗？删除后需要保存才能生效。`,
      confirmColor: '#ef4444',
      success: (res) => {
        if (!res || !res.confirm) {
          return;
        }
        const existing = normalizeAvatarCatalog(this.data.avatarManagerEntries);
        if (!existing.length) {
          return;
        }
        const filtered = existing.filter((entry) => entry.id !== id);
        if (filtered.length === existing.length) {
          return;
        }
        const entries = buildAvatarManagerEntries(filtered);
        const unlocks = normalizeAvatarUnlocks(this.data.avatarManagerUnlocks).filter((value) => value !== id);
        this.commitAvatarManagerState({ entries, unlocks, dirty: true });
        wx.showToast({ title: '已标记删除，记得保存', icon: 'none' });
      }
    });
  },

  async handleAvatarManagerSave() {
    if (this.data.avatarManagerSaving) {
      return;
    }
    const memberId = this.data.memberId;
    if (!memberId) {
      wx.showToast({ title: '缺少会员编号', icon: 'none' });
      return;
    }
    const catalog = normalizeAvatarCatalog(this.data.avatarManagerEntries);
    const unlocks = normalizeAvatarUnlocks(this.data.avatarManagerUnlocks);
    if (!this.data.avatarManagerDirty) {
      this.setData({ avatarPermissionDialogVisible: false, avatarManagerForm: { ...DEFAULT_AVATAR_FORM } });
      return;
    }
    this.setData({ avatarManagerSaving: true });
    try {
      const detail = await AdminService.updateMember(memberId, {
        avatarCatalog: catalog,
        avatarUnlocks: unlocks
      });
      this.applyDetail(detail);
      const updatedMember = (detail && detail.member) || this.data.member || {};
      const savedCatalog = Array.isArray(updatedMember.avatarCatalog) ? updatedMember.avatarCatalog : catalog;
      const savedUnlocks = normalizeAvatarUnlocks(updatedMember.avatarUnlocks || unlocks);
      this.commitAvatarManagerState({
        entries: savedCatalog,
        unlocks: savedUnlocks,
        form: { ...DEFAULT_AVATAR_FORM },
        dirty: false,
        saving: false,
        initialUnlocks: savedUnlocks
      });
      this.setData({
        avatarPermissionDialogVisible: false,
        avatarManagerSaving: false,
        avatarManagerDirty: false,
        avatarManagerForm: { ...DEFAULT_AVATAR_FORM }
      });
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (error) {
      console.error('[admin] save avatars failed', error);
      this.setData({ avatarManagerSaving: false });
      wx.showToast({ title: error.errMsg || error.message || '保存失败', icon: 'none' });
    }
  },

  handleBackgroundManagerInput(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const field = dataset.field;
    if (!field) {
      return;
    }
    const value = event && event.detail && typeof event.detail.value === 'string' ? event.detail.value : '';
    this.setData({
      backgroundManagerForm: {
        ...this.data.backgroundManagerForm,
        [field]: value
      }
    });
  },

  handleBackgroundManagerAdd() {
    const form = this.data.backgroundManagerForm || {};
    const name = typeof form.name === 'string' ? form.name.trim() : '';
    if (!name) {
      wx.showToast({ title: '请输入背景名称', icon: 'none' });
      return;
    }
    const fileInput = typeof form.file === 'string' ? form.file.trim() : '';
    const normalizedMediaKey = normalizeBackgroundMediaKey(fileInput || name);
    if (!normalizedMediaKey) {
      wx.showToast({ title: '请输入文件名', icon: 'none' });
      return;
    }
    const existing = Array.isArray(this.data.backgroundManagerEntries)
      ? this.data.backgroundManagerEntries
      : [];
    const baseList = existing.map((entry) => ({ id: entry.id, name: entry.name, mediaKey: entry.mediaKey }));
    const appended = normalizeBackgroundCatalog(baseList.concat([{ name, mediaKey: normalizedMediaKey }]));
    if (!appended.length) {
      wx.showToast({ title: '添加失败，请重试', icon: 'none' });
      return;
    }
    const entries = buildBackgroundManagerEntries(appended);
    const newEntry = entries[entries.length - 1];
    const unlocks = ensureCustomBackgroundsUnlocked(entries, this.data.backgroundManagerUnlocks);
    if (newEntry && newEntry.id && !unlocks.includes(newEntry.id)) {
      unlocks.push(newEntry.id);
    }
    registerCustomBackgrounds(appended);
    this.commitBackgroundManagerState({
      entries,
      unlocks,
      form: { name: '', file: '' },
      dirty: true
    });
  },

  handleBackgroundManagerRemove(event) {
    const id = event && event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset.id : '';
    const targetId = normalizeBackgroundId(id);
    if (!targetId) {
      return;
    }
    const existing = Array.isArray(this.data.backgroundManagerEntries)
      ? this.data.backgroundManagerEntries
      : [];
    const filtered = existing.filter((entry) => entry && entry.id !== targetId);
    const normalized = normalizeBackgroundCatalog(filtered);
    const entries = buildBackgroundManagerEntries(normalized);
    const unlocks = normalizeBackgroundUnlocks(this.data.backgroundManagerUnlocks).filter(
      (value) => value !== targetId
    );
    registerCustomBackgrounds(normalized);
    this.commitBackgroundManagerState({ entries, unlocks, dirty: true });
  },

  handleCloseBackgroundManager() {
    if (this.data.backgroundManagerSaving) {
      return;
    }
    const member = this.data.member || {};
    const catalog = Array.isArray(member.backgroundCatalog) ? member.backgroundCatalog : [];
    const entries = buildBackgroundManagerEntries(catalog);
    const unlocks = ensureCustomBackgroundsUnlocked(entries, member.backgroundUnlocks);
    registerCustomBackgrounds(catalog);
    this.commitBackgroundManagerState({
      visible: false,
      entries,
      unlocks,
      form: { name: '', file: '' },
      dirty: false
    });
  },

  async handleBackgroundManagerSave() {
    if (this.data.backgroundManagerSaving) {
      return;
    }
    const memberId = this.data.memberId;
    if (!memberId) {
      wx.showToast({ title: '缺少会员编号', icon: 'none' });
      return;
    }
    const catalog = normalizeBackgroundCatalog(this.data.backgroundManagerEntries);
    const entries = buildBackgroundManagerEntries(catalog);
    const unlocks = ensureCustomBackgroundsUnlocked(entries, this.data.backgroundManagerUnlocks);
    this.commitBackgroundManagerState({ saving: true });
    try {
      const detail = await AdminService.updateMember(memberId, {
        backgroundCatalog: catalog,
        backgroundUnlocks: unlocks
      });
      this.applyDetail(detail);
      const updatedMember = this.data.member || {};
      const savedCatalog = Array.isArray(updatedMember.backgroundCatalog)
        ? updatedMember.backgroundCatalog
        : [];
      const savedEntries = buildBackgroundManagerEntries(savedCatalog);
      const savedUnlocks = ensureCustomBackgroundsUnlocked(savedEntries, updatedMember.backgroundUnlocks);
      this.commitBackgroundManagerState({
        visible: false,
        saving: false,
        dirty: false,
        entries: savedEntries,
        unlocks: savedUnlocks,
        form: { name: '', file: '' }
      });
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (error) {
      console.error('[admin] save backgrounds failed', error);
      this.commitBackgroundManagerState({ saving: false });
      wx.showToast({ title: error.errMsg || error.message || '保存失败', icon: 'none' });
    }
  },

  noop() {},

  async handleProxyLogin() {
    if (!this.data.proxyLoginAvailable || this.data.proxyLoginLoading) {
      return;
    }
    const member = this.data.member;
    const memberId = member && member._id ? member._id : '';
    if (!memberId) {
      return;
    }
    this.setData({ proxyLoginLoading: true });
    wx.showLoading({ title: '正在上身', mask: true });
    try {
      await AdminService.proxyLogin(memberId);
      wx.hideLoading();
      wx.showToast({ title: '已切换身份', icon: 'success' });
      setTimeout(() => {
        wx.reLaunch({ url: '/pages/index/index?proxy=1' });
      }, 300);
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: '上身失败，请重试', icon: 'none' });
      console.error('[admin:member] proxy login failed', error);
    } finally {
      this.setData({ proxyLoginLoading: false });
    }
  },

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
  },

  parseSkillDrawCredits(input) {
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

  parseStorageUpgradeAvailable(input) {
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

  parseStorageUpgradeLimit(input) {
    if (input == null || input === '') {
      return null;
    }
    if (typeof input === 'number' && Number.isFinite(input)) {
      const value = Math.max(0, Math.floor(input));
      return value > 0 ? value : null;
    }
    if (typeof input === 'string') {
      const sanitized = input.trim().replace(/[^0-9]/g, '');
      if (!sanitized) {
        return null;
      }
      const parsed = Number(sanitized);
      if (!Number.isFinite(parsed)) {
        return null;
      }
      const value = Math.max(0, Math.floor(parsed));
      return value > 0 ? value : null;
    }
    return null;
  }
});
