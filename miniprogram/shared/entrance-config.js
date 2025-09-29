export const ENTRANCE_GROUPS = {
  BOTTOM_NAV: 'bottomNav',
  ACTIVITY: 'activity'
};

const DEFAULT_CONFIG = Object.freeze({
  [ENTRANCE_GROUPS.BOTTOM_NAV]: {
    role: true,
    equipment: true,
    skill: true,
    rights: true,
    reservation: true,
    wallet: true,
    avatar: true
  },
  [ENTRANCE_GROUPS.ACTIVITY]: {
    pve: true,
    festival: true,
    arena: true
  }
});

const ENTRANCE_GROUP_DEFINITIONS = [
  {
    key: ENTRANCE_GROUPS.BOTTOM_NAV,
    title: '首页底部入口'
  },
  {
    key: ENTRANCE_GROUPS.ACTIVITY,
    title: '活动快捷入口'
  }
];

const ENTRANCE_OPTION_DEFINITIONS = {
  [ENTRANCE_GROUPS.BOTTOM_NAV]: [
    {
      key: 'role',
      label: '角色',
      description: '角色信息与养成入口'
    },
    {
      key: 'equipment',
      label: '装备',
      description: '角色装备详情入口'
    },
    {
      key: 'skill',
      label: '技能',
      description: '角色技能与修炼入口'
    },
    {
      key: 'rights',
      label: '权益',
      description: '会员权益与活动福利入口'
    },
    {
      key: 'reservation',
      label: '预订',
      description: '包房预约申请入口'
    },
    {
      key: 'wallet',
      label: '钱包',
      description: '会员钱包与资产入口'
    },
    {
      key: 'avatar',
      label: '造型',
      description: '头像与外观定制入口'
    }
  ],
  [ENTRANCE_GROUPS.ACTIVITY]: [
    {
      key: 'pve',
      label: '秘境',
      description: '秘境战斗玩法入口'
    },
    {
      key: 'festival',
      label: '盛典',
      description: '节日或主题活动入口'
    },
    {
      key: 'arena',
      label: '比武',
      description: '对战活动预告入口'
    }
  ]
};

function coerceBoolean(value, fallback) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return fallback;
    }
    if (['false', '0', 'off', 'disable', 'disabled'].includes(normalized)) {
      return false;
    }
    if (['true', '1', 'on', 'enable', 'enabled'].includes(normalized)) {
      return true;
    }
  }
  return fallback;
}

export function createDefaultEntranceConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

export function normalizeEntranceConfig(config = {}) {
  const defaults = createDefaultEntranceConfig();
  const normalized = {};
  Object.keys(defaults).forEach((groupKey) => {
    const defaultGroup = defaults[groupKey];
    const incomingGroup = config[groupKey];
    const normalizedGroup = { ...defaultGroup };
    if (incomingGroup && typeof incomingGroup === 'object') {
      Object.keys(defaultGroup).forEach((optionKey) => {
        const value = incomingGroup[optionKey];
        normalizedGroup[optionKey] = coerceBoolean(value, defaultGroup[optionKey]);
      });
    }
    normalized[groupKey] = normalizedGroup;
  });
  return normalized;
}

export function isEntranceEnabled(config, groupKey, optionKey) {
  if (!config || !groupKey || !optionKey) {
    return true;
  }
  const group = config[groupKey];
  if (!group || typeof group !== 'object') {
    return true;
  }
  const value = group[optionKey];
  return typeof value === 'boolean' ? value : true;
}

export function buildEntranceOptionGroups(config = {}) {
  const normalized = normalizeEntranceConfig(config);
  return ENTRANCE_GROUP_DEFINITIONS.map((group) => ({
    ...group,
    items: (ENTRANCE_OPTION_DEFINITIONS[group.key] || []).map((item) => ({
      ...item,
      enabled: isEntranceEnabled(normalized, group.key, item.key)
    }))
  }));
}

export function getEntranceOptionDefinitions() {
  return ENTRANCE_OPTION_DEFINITIONS;
}

export function getEntranceGroupDefinitions() {
  return ENTRANCE_GROUP_DEFINITIONS;
}

export function formatEntranceUpdatedBy(memberRef) {
  if (!memberRef || typeof memberRef !== 'object') {
    return '';
  }
  const nickName = typeof memberRef.nickName === 'string' && memberRef.nickName ? memberRef.nickName : '';
  const id = typeof memberRef._id === 'string' && memberRef._id ? memberRef._id : '';
  if (nickName && id) {
    return `${nickName}（${id}）`;
  }
  return nickName || id || '';
}

export function formatEntranceTimestamp(value) {
  if (!value) {
    return '';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!date || Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (num) => (num < 10 ? `0${num}` : `${num}`);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function mergeEntranceConfig(baseConfig, updates = {}) {
  const base = normalizeEntranceConfig(baseConfig);
  const merged = createDefaultEntranceConfig();
  Object.keys(merged).forEach((groupKey) => {
    const baseGroup = base[groupKey] || {};
    const updateGroup = updates[groupKey] || {};
    const mergedGroup = { ...merged[groupKey] };
    Object.keys(mergedGroup).forEach((optionKey) => {
      const hasUpdate = Object.prototype.hasOwnProperty.call(updateGroup, optionKey);
      if (hasUpdate) {
        mergedGroup[optionKey] = coerceBoolean(updateGroup[optionKey], mergedGroup[optionKey]);
      } else if (Object.prototype.hasOwnProperty.call(baseGroup, optionKey)) {
        mergedGroup[optionKey] = coerceBoolean(baseGroup[optionKey], mergedGroup[optionKey]);
      }
    });
    merged[groupKey] = mergedGroup;
  });
  return merged;
}
