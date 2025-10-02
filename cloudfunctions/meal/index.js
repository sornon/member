const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { MENU_CATEGORIES, findMenuItemById } = require('./menu');

const db = cloud.database();
const _ = db.command;

const COLLECTIONS = {
  MEAL_ORDERS: 'mealOrders',
  MEMBERS: 'members'
};

const ADMIN_ROLES = ['admin', 'developer'];

const STATUS_LABELS = {
  submitted: '待备餐',
  adminConfirmed: '待会员确认扣款',
  memberConfirmed: '已完成'
};

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const rawAction = typeof event.action === 'string' ? event.action.trim() : 'menu';
  const action = rawAction || 'menu';

  switch (action) {
    case 'menu':
      return { categories: MENU_CATEGORIES };
    case 'submitOrder':
      return submitOrder(OPENID, event.order || {});
    case 'latestOrder':
      return getLatestOrder(OPENID);
    case 'markMemberSeen':
      return markMemberSeen(OPENID);
    default:
      throw new Error(`Unknown action: ${action}`);
  }
};

async function submitOrder(openid, orderInput = {}) {
  if (!openid) {
    throw new Error('未获取到会员身份');
  }
  const itemsInput = Array.isArray(orderInput.items) ? orderInput.items : [];
  const note = sanitizeNote(orderInput.note);

  const normalizedItems = [];
  let totalAmount = 0;

  itemsInput.forEach((item) => {
    if (!item) return;
    const itemId = typeof item.itemId === 'string' ? item.itemId : item.id;
    const menuItem = findMenuItemById(itemId);
    if (!menuItem) {
      return;
    }
    const quantity = normalizeQuantity(item.quantity);
    if (quantity <= 0) {
      return;
    }
    const price = normalizeAmount(menuItem.price);
    if (price <= 0) {
      return;
    }
    const subtotal = price * quantity;
    totalAmount += subtotal;
    normalizedItems.push({
      itemId: menuItem.id,
      name: menuItem.name,
      price,
      unit: menuItem.unit || '',
      quantity,
      subtotal,
      categoryId: menuItem.categoryId,
      categoryName: menuItem.categoryName
    });
  });

  if (!normalizedItems.length) {
    throw new Error('请选择至少一道菜品');
  }

  const now = new Date();
  const orderDoc = {
    memberId: openid,
    items: normalizedItems,
    note,
    status: 'submitted',
    totalAmount,
    createdAt: now,
    updatedAt: now,
    adminConfirmedAt: null,
    memberConfirmedAt: null,
    statusHistory: [
      {
        status: 'submitted',
        changedAt: now,
        changedBy: openid
      }
    ]
  };

  const result = await db.collection(COLLECTIONS.MEAL_ORDERS).add({ data: orderDoc });
  const orderId = result && (result._id || result.id);

  await updateAdminMealBadges({ incrementVersion: true });
  const badges = await getMemberMealBadges(openid);

  return {
    success: true,
    order: decorateOrder({ _id: orderId, ...orderDoc }),
    mealOrderBadges: badges
  };
}

async function getLatestOrder(openid) {
  if (!openid) {
    throw new Error('未获取到会员身份');
  }
  const snapshot = await db
    .collection(COLLECTIONS.MEAL_ORDERS)
    .where({ memberId: openid })
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get()
    .catch(() => ({ data: [] }));
  const order = Array.isArray(snapshot.data) && snapshot.data.length ? snapshot.data[0] : null;
  const badges = await getMemberMealBadges(openid);
  return {
    order: decorateOrder(order),
    mealOrderBadges: badges
  };
}

async function markMemberSeen(openid) {
  if (!openid) {
    throw new Error('未获取到会员身份');
  }
  const doc = await db
    .collection(COLLECTIONS.MEMBERS)
    .doc(openid)
    .get()
    .catch(() => null);
  const member = doc && doc.data ? doc.data : null;
  const badges = normalizeMealOrderBadges(member ? member.mealOrderBadges : null);
  if (badges.memberSeenVersion >= badges.memberVersion) {
    return { mealOrderBadges: badges };
  }
  await db
    .collection(COLLECTIONS.MEMBERS)
    .doc(openid)
    .update({
      data: {
        'mealOrderBadges.memberSeenVersion': badges.memberVersion,
        updatedAt: new Date()
      }
    })
    .catch(() => {});
  const updatedBadges = { ...badges, memberSeenVersion: badges.memberVersion };
  return { mealOrderBadges: updatedBadges };
}

function normalizeQuantity(quantity) {
  const numeric = Number(quantity);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.floor(numeric));
}

function normalizeAmount(amount) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.floor(numeric));
}

function sanitizeNote(note) {
  if (!note) {
    return '';
  }
  const text = String(note).trim();
  if (!text) {
    return '';
  }
  return text.slice(0, 200);
}

function decorateOrder(order) {
  if (!order) {
    return null;
  }
  const normalizedStatus = normalizeOrderStatus(order.status);
  const createdAt = resolveDate(order.createdAt);
  const updatedAt = resolveDate(order.updatedAt) || createdAt;
  const adminConfirmedAt = resolveDate(order.adminConfirmedAt);
  const memberConfirmedAt = resolveDate(order.memberConfirmedAt);
  const items = Array.isArray(order.items)
    ? order.items.map((item) => {
        const quantity = normalizeQuantity(item.quantity || 0);
        const price = normalizeAmount(item.price || 0);
        const subtotal = normalizeAmount(item.subtotal || price * quantity);
        return {
          itemId: item.itemId || item.id,
          name: item.name || '',
          unit: item.unit || '',
          quantity,
          price,
          subtotal,
          subtotalLabel: formatCurrency(subtotal)
        };
      })
    : [];
  const totalAmount = normalizeAmount(order.totalAmount || items.reduce((sum, item) => sum + item.subtotal, 0));

  return {
    _id: order._id || order.id || '',
    memberId: order.memberId || '',
    items,
    note: order.note || '',
    status: normalizedStatus,
    statusLabel: STATUS_LABELS[normalizedStatus] || '未知状态',
    totalAmount,
    totalLabel: formatCurrency(totalAmount),
    createdAt,
    createdAtLabel: formatDateTime(createdAt),
    updatedAt,
    updatedAtLabel: formatDateTime(updatedAt),
    adminConfirmedAt,
    adminConfirmedAtLabel: adminConfirmedAt ? formatDateTime(adminConfirmedAt) : '',
    memberConfirmedAt,
    memberConfirmedAtLabel: memberConfirmedAt ? formatDateTime(memberConfirmedAt) : '',
    statusHistory: Array.isArray(order.statusHistory)
      ? order.statusHistory.map((entry) => ({
          status: normalizeOrderStatus(entry.status),
          statusLabel: STATUS_LABELS[normalizeOrderStatus(entry.status)] || '未知状态',
          changedAt: resolveDate(entry.changedAt),
          changedAtLabel: formatDateTime(resolveDate(entry.changedAt)),
          changedBy: entry.changedBy || ''
        }))
      : []
  };
}

function normalizeOrderStatus(status) {
  if (!status) {
    return 'submitted';
  }
  const normalized = String(status).trim();
  if (!normalized) {
    return 'submitted';
  }
  if (normalized === 'memberConfirmed' || normalized === 'adminConfirmed') {
    return normalized;
  }
  return 'submitted';
}

function resolveDate(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function formatCurrency(amount) {
  const numeric = Number(amount) || 0;
  return `¥${(numeric / 100).toFixed(2)}`;
}

function padZero(value) {
  return value < 10 ? `0${value}` : `${value}`;
}

function formatDateTime(date) {
  const resolved = resolveDate(date);
  if (!resolved) {
    return '';
  }
  const year = resolved.getFullYear();
  const month = padZero(resolved.getMonth() + 1);
  const day = padZero(resolved.getDate());
  const hour = padZero(resolved.getHours());
  const minute = padZero(resolved.getMinutes());
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function normalizeMealOrderBadges(badges) {
  const defaults = {
    memberVersion: 0,
    memberSeenVersion: 0,
    adminVersion: 0,
    adminSeenVersion: 0,
    pendingPreparationCount: 0,
    pendingMemberConfirmationCount: 0
  };
  const normalized = { ...defaults };
  if (badges && typeof badges === 'object') {
    Object.keys(defaults).forEach((key) => {
      const value = badges[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        normalized[key] = key.endsWith('Count')
          ? Math.max(0, Math.floor(value))
          : Math.max(0, Math.floor(value));
      } else if (typeof value === 'string' && value) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
          normalized[key] = key.endsWith('Count')
            ? Math.max(0, Math.floor(numeric))
            : Math.max(0, Math.floor(numeric));
        }
      }
    });
  }
  return normalized;
}

async function getMemberMealBadges(memberId) {
  if (!memberId) {
    return normalizeMealOrderBadges(null);
  }
  const doc = await db
    .collection(COLLECTIONS.MEMBERS)
    .doc(memberId)
    .get()
    .catch(() => null);
  const member = doc && doc.data ? doc.data : null;
  const badges = normalizeMealOrderBadges(member ? member.mealOrderBadges : null);
  return badges;
}

async function updateAdminMealBadges({ incrementVersion = false } = {}) {
  try {
    const [pendingResult, adminSnapshot] = await Promise.all([
      db
        .collection(COLLECTIONS.MEAL_ORDERS)
        .where({ status: 'submitted' })
        .count()
        .catch(() => ({ total: 0 })),
      db
        .collection(COLLECTIONS.MEMBERS)
        .where({ roles: _.in(ADMIN_ROLES) })
        .get()
        .catch(() => ({ data: [] }))
    ]);

    const pendingCount = pendingResult && Number.isFinite(pendingResult.total) ? pendingResult.total : 0;
    const admins = Array.isArray(adminSnapshot.data) ? adminSnapshot.data : [];

    await Promise.all(
      admins.map((admin) =>
        db
          .collection(COLLECTIONS.MEMBERS)
          .doc(admin._id)
          .update({
            data: {
              'mealOrderBadges.pendingPreparationCount': pendingCount,
              ...(incrementVersion ? { 'mealOrderBadges.adminVersion': _.inc(1) } : {}),
              updatedAt: new Date()
            }
          })
          .catch(() => {})
      )
    );

    return pendingCount;
  } catch (error) {
    console.error('[meal] update admin badges failed', error);
    return 0;
  }
}
