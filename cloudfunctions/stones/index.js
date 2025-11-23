const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { COLLECTIONS } = require('common-config');
const { createProxyHelpers } = require('admin-proxy');

const db = cloud.database();
const $ = db.command.aggregate;
const _ = db.command;

const proxyHelpers = createProxyHelpers(cloud, { loggerTag: 'stones' });

const STORAGE_CATEGORY_DEFAULT_LABELS = Object.freeze({
  quest: '任务',
  material: '材料',
  consumable: '道具'
});

const MALL_ITEMS = [
  {
    id: 'rename_card_single',
    name: '改名卡',
    icon: '🪪',
    price: 120,
    description: '兑换额外的改名次数，随时焕新道号。',
    effectLabel: '兑换后改名次数 +1',
    effects: { renameCredits: 1 },
    category: 'rename',
    categoryLabel: '改名道具',
    categoryOrder: 1,
    order: 1
  },
  {
    id: 'skill_draw_token_single',
    name: '技能卡',
    icon: '📜',
    price: 5000,
    description: '用于追加一次技能抽取机会，助你锁定心仪神通。',
    effectLabel: '兑换后 +1 次技能抽取',
    effects: { skillDrawCredits: 1 },
    category: 'skill',
    categoryLabel: '技能道具',
    categoryOrder: 2,
    order: 1
  },
  {
    id: 'attribute_respec_card_single',
    name: '属性遗忘卡',
    icon: '🧠',
    price: 2000,
    description: '重置属性配置的必备道具，兑换后可额外获得一次洗点机会。',
    effectLabel: '兑换后 +1 次洗点机会',
    effects: { respecAvailable: 1 },
    category: 'attribute',
    categoryLabel: '属性道具',
    categoryOrder: 3,
    order: 1
  }
];

const CHINESE_UNIT_MULTIPLIERS = {
  万亿: 1000000000000,
  亿: 100000000,
  万: 10000,
  千: 1000,
  百: 100
};

function parseAmountNumber(value) {
  if (value == null) {
    return NaN;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : NaN;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return 0;
    }
    const normalized = trimmed.replace(/[,，\s]/g, '');
    const unitMatch = normalized.match(/([-+]?\d+(?:\.\d+)?)(万亿|亿|万|千|百)/);
    if (unitMatch) {
      const base = Number(unitMatch[1]);
      const multiplier = CHINESE_UNIT_MULTIPLIERS[unitMatch[2]] || 1;
      const result = base * multiplier;
      if (Number.isFinite(result)) {
        return result;
      }
    }
    const numericMatch = normalized.match(/([-+]?\d+(?:\.\d+)?)/);
    if (numericMatch) {
      const numeric = Number(numericMatch[1]);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
    }
    const sanitized = normalized.replace(/[^0-9+.-]/g, '');
    if (!sanitized) {
      return 0;
    }
    const parsed = Number(sanitized);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'object') {
    if (typeof value.toNumber === 'function') {
      try {
        const numeric = value.toNumber();
        if (Number.isFinite(numeric)) {
          return numeric;
        }
      } catch (error) {
        // ignore conversion errors
      }
    }
    if (typeof value.valueOf === 'function') {
      const primitive = value.valueOf();
      if (typeof primitive === 'number' && Number.isFinite(primitive)) {
        return primitive;
      }
      const numeric = Number(primitive);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
    }
    if (typeof value.toString === 'function') {
      const numeric = Number(value.toString());
      if (Number.isFinite(numeric)) {
        return numeric;
      }
    }
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : NaN;
}

function normalizeEffectAmount(value) {
  const numeric = parseAmountNumber(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.floor(numeric));
}

function ensurePlainObject(value) {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return { ...value };
}

function ensurePveProfile(profile) {
  const base = ensurePlainObject(profile);
  base.skills = ensurePlainObject(base.skills);
  base.attributes = ensurePlainObject(base.attributes);
  return base;
}

function ensureMallRewardProfile(profile) {
  const base = profile && typeof profile === 'object' ? { ...profile } : {};
  const equipment = base.equipment && typeof base.equipment === 'object' ? { ...base.equipment } : {};
  equipment.inventory = Array.isArray(equipment.inventory)
    ? equipment.inventory.map((item) => ({ ...item }))
    : [];
  const storage = equipment.storage && typeof equipment.storage === 'object' ? { ...equipment.storage } : {};
  storage.categories = Array.isArray(storage.categories)
    ? storage.categories.map((category) => ({
        ...(category || {}),
        items: Array.isArray(category && category.items)
          ? category.items.map((item) => ({ ...item }))
          : []
      }))
    : [];
  equipment.storage = storage;
  base.equipment = equipment;

  const skills = base.skills && typeof base.skills === 'object' ? { ...base.skills } : {};
  skills.inventory = Array.isArray(skills.inventory)
    ? skills.inventory.map((item) => ({ ...item }))
    : [];
  skills.equipped = Array.isArray(skills.equipped) ? skills.equipped.slice() : [];
  base.skills = skills;

  base.attributes = base.attributes && typeof base.attributes === 'object' ? { ...base.attributes } : {};

  return base;
}

function resolveStorageCategoryLabel(key) {
  return STORAGE_CATEGORY_DEFAULT_LABELS[key] || key || '道具';
}

function ensureStorageCategoryEntry(storage, key) {
  if (!storage || typeof storage !== 'object') {
    return { key, label: resolveStorageCategoryLabel(key), items: [] };
  }
  const categories = Array.isArray(storage.categories) ? storage.categories : [];
  let entry = categories.find((category) => category && category.key === key);
  if (!entry) {
    entry = { key, label: resolveStorageCategoryLabel(key), items: [] };
    categories.push(entry);
    storage.categories = categories;
  } else if (!Array.isArray(entry.items)) {
    entry.items = [];
  }
  entry.label = entry.label || resolveStorageCategoryLabel(key);
  return entry;
}

function generateStorageInventoryId(itemId, obtainedAt = new Date()) {
  const base = typeof itemId === 'string' && itemId ? itemId : 'storage';
  const timestamp =
    obtainedAt instanceof Date && !Number.isNaN(obtainedAt.getTime()) ? obtainedAt.getTime() : Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `st-${base}-${timestamp}-${random}`;
}

function sanitizeStorageActions(actions) {
  if (!Array.isArray(actions)) {
    return [{ key: 'use', label: '使用', primary: true }];
  }
  const normalized = actions
    .map((action) => ({
      key: typeof action.key === 'string' ? action.key : '',
      label: typeof action.label === 'string' ? action.label : '',
      primary: !!action.primary
    }))
    .filter((action) => action.key && action.label);
  if (!normalized.length) {
    normalized.push({ key: 'use', label: '使用', primary: true });
  }
  return normalized;
}

function createStorageItemFromDefinition(definition, obtainedAt = new Date()) {
  if (!definition || typeof definition !== 'object') {
    return null;
  }
  const safeObtainedAt =
    obtainedAt instanceof Date && !Number.isNaN(obtainedAt.getTime()) ? obtainedAt : new Date();
  const itemId =
    typeof definition.itemId === 'string' && definition.itemId.trim()
      ? definition.itemId.trim()
      : definition.id || 'mall-item';
  const storageCategory = typeof definition.storageCategory === 'string' && definition.storageCategory
    ? definition.storageCategory
    : 'consumable';
  const item = {
    inventoryId: generateStorageInventoryId(itemId, safeObtainedAt),
    itemId,
    name: definition.name || '道具',
    shortName: definition.shortName || definition.name || '道具',
    description: definition.description || '',
    iconUrl: definition.iconUrl || '',
    iconFallbackUrl: definition.iconFallbackUrl || '',
    quality: definition.quality || '',
    qualityLabel: definition.qualityLabel || '',
    qualityColor: definition.qualityColor || '',
    storageCategory,
    slotLabel: definition.slotLabel || resolveStorageCategoryLabel(storageCategory),
    obtainedAt: safeObtainedAt,
    usage: definition.usage && typeof definition.usage === 'object' ? { ...definition.usage } : null,
    actions: sanitizeStorageActions(definition.actions),
    notes: Array.isArray(definition.notes) ? definition.notes.filter(Boolean) : [],
    kind: 'storage'
  };
  item.primaryAction = item.actions.find((action) => action.primary) || item.actions[0] || null;
  return item;
}

function appendStorageReward(profile, definition, quantity = 1) {
  if (!profile || !definition) {
    return 0;
  }
  const safeQuantity = Math.max(1, Math.floor(Number(quantity) || 1));
  const equipment = profile.equipment && typeof profile.equipment === 'object' ? profile.equipment : null;
  const storage = equipment && typeof equipment.storage === 'object' ? equipment.storage : null;
  if (!storage) {
    return 0;
  }
  const categoryKey =
    typeof definition.storageCategory === 'string' && definition.storageCategory
      ? definition.storageCategory
      : 'consumable';
  const category = ensureStorageCategoryEntry(storage, categoryKey);
  const added = [];
  for (let i = 0; i < safeQuantity; i += 1) {
    const obtainedAt = new Date(Date.now() + i);
    const item = createStorageItemFromDefinition(definition, obtainedAt);
    if (!item) {
      continue;
    }
    category.items.push(item);
    added.push(item);
  }
  return added.length;
}

function applyMallProfileEffects(member, effects, quantity) {
  if (!effects || typeof effects !== 'object') {
    return null;
  }

  const normalizedQuantity = Math.max(1, Math.floor(Number(quantity) || 1));
  const skillDrawIncrease = normalizeEffectAmount(effects.skillDrawCredits) * normalizedQuantity;
  const respecIncrease = normalizeEffectAmount(effects.respecAvailable) * normalizedQuantity;

  if (skillDrawIncrease <= 0 && respecIncrease <= 0) {
    return null;
  }

  const profile = ensurePveProfile(member && member.pveProfile);
  let changed = false;

  if (skillDrawIncrease > 0) {
    const skills = ensurePlainObject(profile.skills);
    const currentCredits = Math.max(0, Math.floor(Number(skills.drawCredits) || 0));
    const nextCredits = currentCredits + skillDrawIncrease;
    if (nextCredits !== currentCredits) {
      skills.drawCredits = nextCredits;
      profile.skills = skills;
      changed = true;
    }
  }

  if (respecIncrease > 0) {
    const attributes = ensurePlainObject(profile.attributes);
    const currentAvailable = Math.max(0, Math.floor(Number(attributes.respecAvailable) || 0));
    const legacyLimit = Math.max(0, Math.floor(Number(attributes.respecLimit) || 0));
    const legacyUsed = Math.max(0, Math.floor(Number(attributes.respecUsed) || 0));
    const legacyAvailable = Math.max(legacyLimit - Math.min(legacyLimit, legacyUsed), 0);
    const baseAvailable = Math.max(currentAvailable, legacyAvailable);
    const nextAvailable = baseAvailable + respecIncrease;
    if (nextAvailable !== baseAvailable || attributes.respecLimit || attributes.respecUsed) {
      attributes.respecAvailable = nextAvailable;
      attributes.respecLimit = 0;
      attributes.respecUsed = 0;
      profile.attributes = attributes;
      changed = true;
    }
  }

  return changed ? profile : null;
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'summary';
  const { memberId: actingMemberId, proxySession } = await proxyHelpers.resolveProxyContext(OPENID);
  const targetMemberId = actingMemberId || OPENID;

  if (proxySession) {
    await proxyHelpers.recordProxyAction(proxySession, OPENID, action, event || {});
  }

  switch (action) {
    case 'summary':
      return getSummary(targetMemberId);
    case 'catalog':
      return getCatalog();
    case 'purchase':
      return purchaseItem(targetMemberId, event.itemId, event.quantity || 1);
    default:
      throw new Error(`Unknown action: ${action}`);
  }
};

function createError(code, message) {
  const finalMessage = message || '发生未知错误';
  const error = new Error(finalMessage);
  error.code = code;
  error.errCode = code;
  error.errMsg = finalMessage;
  return error;
}

async function getSummary(memberId) {
  const [memberDoc, transactionsSnapshot, totalsSnapshot] = await Promise.all([
    db.collection(COLLECTIONS.MEMBERS).doc(memberId).get().catch(() => null),
    db
      .collection(COLLECTIONS.STONE_TRANSACTIONS)
      .where({ memberId })
      .orderBy('createdAt', 'desc')
      .limit(30)
      .get(),
    aggregateStoneTotals(memberId)
  ]);

  const member = memberDoc && memberDoc.data ? memberDoc.data : {};
  const balance = resolveStoneBalance(member);
  const transactions = transactionsSnapshot.data || [];
  const { totalEarned, totalSpent } = resolveTotals({
    snapshot: totalsSnapshot,
    transactions
  });

  return {
    stoneBalance: balance,
    balance,
    totalEarned,
    totalSpent,
    transactions: transactions.map(mapTransaction)
  };
}

async function aggregateStoneTotals(memberId) {
  if (!memberId) {
    return null;
  }
  try {
    return await db
      .collection(COLLECTIONS.STONE_TRANSACTIONS)
      .aggregate()
      .match({ memberId })
      .group({
        _id: null,
        totalEarned: $.sum(
          $.cond({
            if: $.gt(['$amount', 0]),
            then: $.floor('$amount'),
            else: 0
          })
        ),
        totalSpent: $.sum(
          $.cond({
            if: $.lt(['$amount', 0]),
            then: $.abs($.floor('$amount')),
            else: 0
          })
        )
      })
      .end();
  } catch (error) {
    console.error('[stones] aggregate totals failed', error);
    return null;
  }
}

function resolveTotals({ snapshot, transactions }) {
  const fallbackTotals = calculateTotalsFromTransactions(transactions);
  if (!snapshot || !snapshot.list || !snapshot.list.length) {
    return fallbackTotals;
  }
  const doc = snapshot.list[0] || {};
  const totalEarned = normalizeAmount(doc.totalEarned);
  const totalSpent = Math.abs(normalizeAmount(doc.totalSpent));
  if (!Number.isFinite(totalEarned) || !Number.isFinite(totalSpent)) {
    return fallbackTotals;
  }
  return {
    totalEarned: Math.max(0, totalEarned),
    totalSpent: Math.max(0, totalSpent)
  };
}

function calculateTotalsFromTransactions(transactions) {
  if (!Array.isArray(transactions) || !transactions.length) {
    return { totalEarned: 0, totalSpent: 0 };
  }
  return transactions.reduce(
    (acc, item) => {
      const amount = normalizeAmount(item.amount);
      if (amount > 0) {
        acc.totalEarned += amount;
      } else if (amount < 0) {
        acc.totalSpent += Math.abs(amount);
      }
      return acc;
    },
    { totalEarned: 0, totalSpent: 0 }
  );
}

function mapTransaction(txn) {
  const amount = normalizeAmount(txn.amount);
  const type = txn.type || (amount >= 0 ? 'earn' : 'spend');
  return {
    _id: txn._id,
    amount,
    change: amount,
    type,
    typeLabel: transactionTypeLabel[type] || (amount >= 0 ? '获得' : '消耗'),
    description: txn.description || '',
    source: txn.source || '',
    createdAt: txn.createdAt || new Date(),
    meta: txn.meta || null
  };
}

function resolveStoneBalance(member) {
  if (!member) return 0;
  const numeric = parseAmountNumber(member.stoneBalance);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return Math.floor(numeric);
  }
  return 0;
}

function normalizeAmount(value) {
  const numeric = parseAmountNumber(value);
  if (!Number.isFinite(numeric) || numeric === 0) {
    return 0;
  }
  return Math.trunc(numeric);
}

const transactionTypeLabel = {
  earn: '获得',
  spend: '消耗',
  adjust: '调整',
  task: '任务奖励',
  reward: '奖励'
};

function getCatalog() {
  return {
    items: MALL_ITEMS.map((item) => {
      const priceNumber = parseAmountNumber(item.price);
      const normalizedPrice = Number.isFinite(priceNumber) ? priceNumber : 0;
      return {
        id: item.id,
        name: item.name,
        icon: item.icon || '',
        iconUrl: item.iconUrl || '',
        price: Math.max(0, Math.floor(normalizedPrice)),
        description: item.description || '',
        effectLabel: item.effectLabel || '',
        category: item.category || 'general',
        categoryLabel:
          item.categoryLabel ||
          (item.category === 'general' ? '奇珍异宝' : '其他道具'),
        categoryOrder: Number.isFinite(Number(item.categoryOrder))
          ? Number(item.categoryOrder)
          : null,
        order: Number.isFinite(Number(item.order)) ? Number(item.order) : null
      };
    })
  };
}

async function purchaseItem(memberId, itemId, quantity = 1) {
  if (!memberId) {
    throw createError('AUTH_REQUIRED', '请先登录后再兑换');
  }
  const normalizedId = typeof itemId === 'string' ? itemId.trim() : '';
  if (!normalizedId) {
    throw createError('INVALID_ITEM', '请选择要兑换的道具');
  }
  const item = MALL_ITEMS.find((entry) => entry.id === normalizedId);
  if (!item) {
    throw createError('ITEM_NOT_FOUND', '道具不存在或已下架');
  }

  const quantityNumber = Number(quantity);
  if (!Number.isFinite(quantityNumber) || quantityNumber <= 0) {
    throw createError('INVALID_QUANTITY', '兑换数量无效');
  }
  const normalizedQuantity = Math.max(1, Math.floor(quantityNumber));
  const priceNumber = parseAmountNumber(item.price);
  const unitPrice = Number.isFinite(priceNumber) ? Math.max(0, Math.floor(priceNumber)) : 0;
  const totalCost = unitPrice * normalizedQuantity;
  if (totalCost <= 0) {
    throw createError('INVALID_PRICE', '该道具暂无法兑换');
  }

  const membersCollection = db.collection(COLLECTIONS.MEMBERS);
  const existing = await membersCollection.doc(memberId).get().catch(() => null);
  if (!existing || !existing.data) {
    throw createError('MEMBER_NOT_FOUND', '请先完成会员注册');
  }
  const member = existing.data;
  const balance = resolveStoneBalance(member);
  if (balance < totalCost) {
    const shortfall = Math.max(totalCost - balance, 0);
    return {
      success: false,
      code: 'STONE_INSUFFICIENT',
      message: `灵石不足，还需 ${totalCost}`,
      item: {
        id: item.id,
        name: item.name
      },
      quantity: normalizedQuantity,
      balance,
      cost: totalCost,
      shortfall,
      summary: {
        stoneBalance: balance,
        balance
      }
    };
  }

  const updates = {
    stoneBalance: _.inc(-totalCost),
    updatedAt: new Date()
  };

  const renameCreditsIncrease = normalizeEffectAmount(item.effects && item.effects.renameCredits);
  if (renameCreditsIncrease > 0) {
    updates.renameCredits = _.inc(renameCreditsIncrease * normalizedQuantity);
  }

  let profileForUpdate = null;
  let profileChanged = false;

  const profileWithEffects = applyMallProfileEffects(member, item.effects, normalizedQuantity);
  if (profileWithEffects) {
    profileForUpdate = profileWithEffects;
    profileChanged = true;
  }

  if (item.storageReward) {
    profileForUpdate = ensureMallRewardProfile(profileForUpdate || member && member.pveProfile);
    const addedCount = appendStorageReward(profileForUpdate, item.storageReward, normalizedQuantity);
    if (addedCount > 0) {
      profileChanged = true;
    }
  }

  if (profileChanged && profileForUpdate) {
    updates.pveProfile = _.set(profileForUpdate);
  }

  await membersCollection.doc(memberId).update({
    data: updates
  });

  const serverDate = typeof db.serverDate === 'function' ? db.serverDate() : new Date();
  const description = normalizedQuantity > 1 ? `${item.name} x${normalizedQuantity}` : item.name;
  await db.collection(COLLECTIONS.STONE_TRANSACTIONS).add({
    data: {
      memberId,
      amount: -totalCost,
      type: 'spend',
      source: 'mall',
      description: `购买${description}`,
      meta: { itemId: item.id, quantity: normalizedQuantity },
      createdAt: serverDate
    }
  });

  const summary = await getSummary(memberId);
  return {
    success: true,
    item: {
      id: item.id,
      name: item.name
    },
    quantity: normalizedQuantity,
    summary
  };
}
