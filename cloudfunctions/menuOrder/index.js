const cloud = require('wx-server-sdk');
const {
  EXPERIENCE_PER_YUAN,
  COLLECTIONS,
  DEFAULT_ADMIN_ROLES,
  analyzeMemberLevelProgress
} = require('common-config'); //云函数公共模块，维护在目录cloudfunctions/nodejs-layer/node_modules/common-config
const { createProxyHelpers } = require('admin-proxy');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const proxyHelpers = createProxyHelpers(cloud, { loggerTag: 'menuOrder' });

const ADMIN_ROLES = [...new Set([...DEFAULT_ADMIN_ROLES, 'superadmin'])];
const CATEGORY_TYPES = ['drinks', 'dining'];
const DRINK_VOUCHER_RIGHT_ID = 'right_realm_qi_drink';
const DRINK_VOUCHER_AMOUNT_LIMIT = 12000;
const CUBANEY_VOUCHER_RIGHT_ID = 'right_realm_core_cubaney_voucher';
const CUBANEY_VOUCHER_AMOUNT = 98000;
const CUBANEY_MENU_IDS = ['drinks_rum_cubaney-10'];
const CUBANEY_TITLE_KEYWORDS = ['古巴邑 10 年'];
const ensuredCollections = new Set();

const ERROR_CODES = {
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS'
};

function isCollectionNotFoundError(error) {
  if (!error) return false;
  if (error.errCode === -502005 || error.code === 'ResourceNotFound') {
    return true;
  }
  const message = typeof error.message === 'string' ? error.message : '';
  return /collection\s+not\s+exists/i.test(message) || /ResourceNotFound/i.test(message);
}

function isCollectionAlreadyExistsError(error) {
  if (!error) return false;
  if (error.errCode === -502006 || error.code === 'ResourceExists') {
    return true;
  }
  const message = typeof error.message === 'string' ? error.message : '';
  return /already\s+exists/i.test(message);
}

function createCustomError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.errCode = code;
  return error;
}

function isCustomError(error, code) {
  if (!error || !code) {
    return false;
  }
  return error.code === code || error.errCode === code;
}

async function ensureCollection(name) {
  if (!name || ensuredCollections.has(name)) {
    return;
  }
  try {
    await db
      .collection(name)
      .limit(1)
      .get();
    ensuredCollections.add(name);
  } catch (error) {
    if (!isCollectionNotFoundError(error)) {
      throw error;
    }
    if (typeof db.createCollection !== 'function') {
      throw error;
    }
    try {
      await db.createCollection(name);
      ensuredCollections.add(name);
    } catch (createError) {
      if (isCollectionAlreadyExistsError(createError)) {
        ensuredCollections.add(name);
        return;
      }
      throw createError;
    }
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'listMemberOrders';
  const { memberId: actingMemberId, proxySession } = await proxyHelpers.resolveProxyContext(OPENID);
  const targetMemberId = actingMemberId || OPENID;

  if (proxySession) {
    await proxyHelpers.recordProxyAction(proxySession, OPENID, action, event || {});
  }

  switch (action) {
    case 'createOrder':
      return createOrder(
        targetMemberId,
        event.items || [],
        event.remark || '',
        event.categoryTotals || {},
        { useDrinkVoucher: event.useDrinkVoucher }
      );
    case 'listMemberOrders':
      return listMemberOrders(targetMemberId);
    case 'confirmMemberOrder':
      return confirmMemberOrder(targetMemberId, event.orderId);
    case 'cancelMemberOrder':
      return cancelMemberOrder(targetMemberId, event.orderId, event.remark || event.reason || '');
    case 'listPrepOrders':
      return listPrepOrders(targetMemberId, event.status || 'submitted', event.pageSize || 100);
    case 'markOrderReady':
      return markOrderReady(targetMemberId, event.orderId, event.remark || '');
    case 'cancelOrder':
      return cancelOrder(targetMemberId, event.orderId, event.remark || event.reason || '');
    default:
      throw new Error(`Unknown action: ${action}`);
  }
};

async function createOrder(openid, itemsInput, remarkInput, categoryTotalsInput = {}, options = {}) {
  const member = await ensureMember(openid);
  const items = normalizeItems(itemsInput);
  if (!items.length) {
    throw new Error('请至少选择一件商品');
  }
  const originalTotalAmount = items.reduce((sum, item) => sum + item.amount, 0);
  if (!originalTotalAmount || originalTotalAmount <= 0) {
    throw new Error('订单金额无效');
  }
  const categoryTotals = normalizeCategoryTotals(categoryTotalsInput);
  const now = new Date();
  await ensureCollection(COLLECTIONS.MENU_ORDERS);

  let orderRecord = null;

  await db.runTransaction(async (transaction) => {
    let discountAmount = 0;
    const updatedItems = items.map((item) => ({ ...item }));
    const updatedCategoryTotals = { ...categoryTotals };
    const appliedRights = [];
    const lockedRights = [];

    const allowDrinkVoucher =
      options && Object.prototype.hasOwnProperty.call(options, 'useDrinkVoucher')
        ? !!options.useDrinkVoucher
        : true;

    const drinkVoucherCandidate = allowDrinkVoucher ? resolveDrinkVoucherCandidate(updatedItems) : null;
    if (drinkVoucherCandidate && allowDrinkVoucher) {
      const lockedRight = await lockDrinkVoucherRight(transaction, openid, now);
      if (lockedRight) {
        const discount = drinkVoucherCandidate.discount;
        if (discount > 0) {
          const target = updatedItems[drinkVoucherCandidate.index];
          const currentAmount = Number(target.amount || target.price * target.quantity);
          const nextAmount = Math.max(0, currentAmount - discount);
          updatedItems[drinkVoucherCandidate.index] = {
            ...target,
            amount: nextAmount,
            discount: (Number(target.discount || 0) || 0) + discount
          };
          updatedCategoryTotals.drinks = Math.max(
            0,
            Math.round(Number(updatedCategoryTotals.drinks || 0)) - discount
          );
          discountAmount += discount;
          appliedRights.push({
            memberRightId: lockedRight._id,
            rightId: lockedRight.rightId,
            amount: discount,
            type: 'drinkVoucher',
            title: lockedRight.title || '任意饮品券（120 元内）'
          });
          lockedRights.push({
            id: lockedRight._id,
            type: 'drinkVoucher',
            discount,
            meta: lockedRight.meta || {}
          });
        }
      }
    }

    const allowCubaneyVoucher =
      options && Object.prototype.hasOwnProperty.call(options, 'useCubaneyVoucher')
        ? !!options.useCubaneyVoucher
        : true;
    const cubaneyVoucherCandidate = allowCubaneyVoucher
      ? resolveCubaneyVoucherCandidate(updatedItems)
      : null;
    if (cubaneyVoucherCandidate && allowCubaneyVoucher) {
      const lockedRight = await lockCubaneyVoucherRight(transaction, openid, now);
      if (lockedRight) {
        const discount = cubaneyVoucherCandidate.discount;
        if (discount > 0) {
          const target = updatedItems[cubaneyVoucherCandidate.index];
          const currentAmount = Number(target.amount || target.price * target.quantity);
          const nextAmount = Math.max(0, currentAmount - discount);
          updatedItems[cubaneyVoucherCandidate.index] = {
            ...target,
            amount: nextAmount,
            discount: (Number(target.discount || 0) || 0) + discount
          };
          updatedCategoryTotals.drinks = Math.max(
            0,
            Math.round(Number(updatedCategoryTotals.drinks || 0)) - discount
          );
          discountAmount += discount;
          appliedRights.push({
            memberRightId: lockedRight._id,
            rightId: lockedRight.rightId,
            amount: discount,
            type: 'cubaneyVoucher',
            title: lockedRight.title || '古巴邑 10 年兑换券'
          });
          lockedRights.push({
            id: lockedRight._id,
            type: 'cubaneyVoucher',
            discount,
            meta: lockedRight.meta || {}
          });
        }
      }
    }

    const totalAmount = Math.max(0, originalTotalAmount - discountAmount);
    const orderData = {
      memberId: openid,
      memberSnapshot: {
        nickName: member.nickName || '',
        mobile: member.mobile || '',
        levelId: member.levelId || ''
      },
      items: updatedItems,
      totalAmount,
      originalTotalAmount,
      categoryTotals: updatedCategoryTotals,
      remark: normalizeRemark(remarkInput),
      status: 'submitted',
      createdAt: now,
      updatedAt: now
    };

    if (appliedRights.length) {
      orderData.appliedRights = appliedRights;
      orderData.discountTotal = discountAmount;
      orderData.drinkVoucherApplied = appliedRights.some((entry) => entry.type === 'drinkVoucher');
      orderData.cubaneyVoucherApplied = appliedRights.some((entry) => entry.type === 'cubaneyVoucher');
    }

    const result = await transaction.collection(COLLECTIONS.MENU_ORDERS).add({ data: orderData });
    orderRecord = { _id: result._id, ...orderData };

    await Promise.all(
      lockedRights.map((entry) =>
        transaction
          .collection(COLLECTIONS.MEMBER_RIGHTS)
          .doc(entry.id)
          .update({
            data: {
              status: 'locked',
              orderId: result._id,
              lockedAt: now,
              updatedAt: now,
              meta: {
                ...(entry.meta || {}),
                lockedFor: entry.type,
                lockedDiscountAmount: entry.discount,
                lockedOrderId: result._id
              }
            }
          })
      )
    );
  });

  return { order: mapOrder(orderRecord) };
}

async function listMemberOrders(openid) {
  await ensureMember(openid);
  try {
    await ensureCollection(COLLECTIONS.MENU_ORDERS);
  } catch (error) {
    if (isCollectionNotFoundError(error)) {
      return { orders: [] };
    }
    throw error;
  }
  let snapshot;
  try {
    snapshot = await db
      .collection(COLLECTIONS.MENU_ORDERS)
      .where({ memberId: openid })
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
  } catch (error) {
    if (isCollectionNotFoundError(error)) {
      return { orders: [] };
    }
    throw error;
  }
  const orders = (snapshot?.data || []).map((doc) => mapOrder({ _id: doc._id, ...doc }));
  return { orders };
}

async function ensureChargeOrderForMenuOrder(transaction, orderId, order, adminId, now) {
  const totalAmount = Number(order.totalAmount || 0);
  if (!Number.isFinite(totalAmount) || totalAmount < 0) {
    throw new Error('订单金额无效');
  }
  if (totalAmount === 0) {
    return { id: '', order: null };
  }
  const items = buildChargeItemsFromMenuOrder(order);
  const baseStoneReward = totalAmount;
  const remark = typeof order.remark === 'string' ? order.remark : '';
  const memberId = typeof order.memberId === 'string' ? order.memberId : '';
  const memberSnapshot = buildMemberSnapshot(order.memberSnapshot);
  const existingId = typeof order.chargeOrderId === 'string' ? order.chargeOrderId.trim() : '';
  const normalizedOrder = mapOrder({ _id: orderId, ...order }) || {};
  const normalizedAppliedRights = Array.isArray(normalizedOrder.appliedRights)
    ? normalizedOrder.appliedRights
    : [];
  const appliedRights = normalizedAppliedRights.map((entry) => ({
        memberRightId: entry.memberRightId || '',
        rightId: entry.rightId || '',
        amount: Number(entry.amount || 0),
        type: entry.type || '',
        title: entry.title || ''
      }));
  let discountTotal = Number(normalizedOrder.discountTotal || 0);
  if ((!Number.isFinite(discountTotal) || discountTotal <= 0) && appliedRights.length) {
    discountTotal = appliedRights.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
  }
  const normalizedDiscountTotal = Number.isFinite(discountTotal) && discountTotal > 0 ? discountTotal : 0;
  if (existingId) {
    const chargeOrderRef = transaction.collection(COLLECTIONS.CHARGE_ORDERS).doc(existingId);
    const chargeSnapshot = await chargeOrderRef.get().catch(() => null);
    if (chargeSnapshot && chargeSnapshot.data) {
      const current = chargeSnapshot.data;
      const adminAdjustment = normalizeAdminPriceAdjustment(order.adminPriceAdjustment);
      const adjustmentHistory = normalizeAdminPriceAdjustmentHistory(
        order.adminPriceAdjustmentHistory,
        order.adminPriceAdjustment
      );
      const updates = {
        items,
        totalAmount,
        updatedAt: now,
        memberId,
        memberSnapshot,
        menuOrderId: orderId,
        source: 'menuOrder',
        remark,
        appliedRights,
        discountTotal: normalizedDiscountTotal,
        ...(adminAdjustment
          ? {
              priceAdjustment: adminAdjustment,
              priceAdjustmentHistory: adjustmentHistory,
              originalTotalAmount:
                Number(order.originalTotalAmount || 0) > 0
                  ? Number(order.originalTotalAmount)
                  : Number(adminAdjustment.previousAmount || 0) || totalAmount
            }
          : {})
      };
      if (!Number(current.stoneReward)) {
        updates.stoneReward = baseStoneReward;
      }
      if (!current.createdBy && adminId) {
        updates.createdBy = adminId;
      }
      await chargeOrderRef.update({ data: updates }).catch(() => null);
      return { id: existingId, order: { _id: existingId, ...current, ...updates } };
    }
  }
  const chargeOrderData = {
    status: 'pending',
    items,
    totalAmount,
    stoneReward: baseStoneReward,
    createdBy: adminId || '',
    createdAt: now,
    updatedAt: now,
    memberId,
    memberSnapshot,
    menuOrderId: orderId,
    source: 'menuOrder',
    remark,
    appliedRights,
    discountTotal: normalizedDiscountTotal,
    ...(order.adminPriceAdjustment
      ? {
          priceAdjustment: normalizeAdminPriceAdjustment(order.adminPriceAdjustment),
          priceAdjustmentHistory: normalizeAdminPriceAdjustmentHistory(
            order.adminPriceAdjustmentHistory,
            order.adminPriceAdjustment
          ),
          originalTotalAmount:
            Number(order.originalTotalAmount || 0) > 0
              ? Number(order.originalTotalAmount)
              : Number(order.adminPriceAdjustment.previousAmount || 0) || totalAmount
        }
      : {})
  };
  const result = await transaction.collection(COLLECTIONS.CHARGE_ORDERS).add({
    data: chargeOrderData
  });
  return { id: result._id, order: { _id: result._id, ...chargeOrderData } };
}

async function markOrderReady(openid, orderId, remarkInput) {
  const admin = await ensureAdmin(openid);
  if (!orderId) {
    throw new Error('缺少订单编号');
  }
  const remark = normalizeRemark(remarkInput, 200);
  const now = new Date();
  const adminId = admin._id || openid;
  let updatedOrder = null;
  await Promise.all([
    ensureCollection(COLLECTIONS.MENU_ORDERS),
    ensureCollection(COLLECTIONS.CHARGE_ORDERS)
  ]);
  await db.runTransaction(async (transaction) => {
    const orderRef = transaction.collection(COLLECTIONS.MENU_ORDERS).doc(orderId);
    const snapshot = await orderRef.get().catch(() => null);
    if (!snapshot || !snapshot.data) {
      throw new Error('订单不存在');
    }
    const order = snapshot.data;
    if (order.status !== 'submitted') {
      throw new Error('订单已处理');
    }
    const { id: chargeOrderId } = await ensureChargeOrderForMenuOrder(
      transaction,
      orderId,
      order,
      adminId,
      now
    );
    const updates = {
      status: 'pendingMember',
      adminId: adminId,
      adminSnapshot: {
        nickName: admin.nickName || '',
        roles: Array.isArray(admin.roles) ? admin.roles : []
      },
      adminRemark: remark,
      adminConfirmedAt: now,
      updatedAt: now,
      chargeOrderId
    };
    await orderRef.update({ data: updates });
    updatedOrder = mapOrder({ _id: orderId, ...order, ...updates });
  });
  return { order: updatedOrder };
}

async function listPrepOrders(openid, status = 'submitted', pageSize = 100) {
  await ensureAdmin(openid);
  const normalizedSize = Math.min(Math.max(Number(pageSize) || 20, 1), 200);
  let statuses;
  if (status === 'all') {
    statuses = ['submitted', 'pendingMember', 'cancelled'];
  } else if (status === 'pendingMember') {
    statuses = ['pendingMember'];
  } else {
    statuses = ['submitted'];
  }
  try {
    await ensureCollection(COLLECTIONS.MENU_ORDERS);
  } catch (error) {
    if (isCollectionNotFoundError(error)) {
      return { orders: [] };
    }
    throw error;
  }
  let snapshot;
  try {
    snapshot = await db
      .collection(COLLECTIONS.MENU_ORDERS)
      .where({ status: _.in(statuses) })
      .orderBy('createdAt', 'desc')
      .limit(normalizedSize)
      .get();
  } catch (error) {
    if (isCollectionNotFoundError(error)) {
      return { orders: [] };
    }
    throw error;
  }
  const orders = (snapshot?.data || []).map((doc) => mapOrder({ _id: doc._id, ...doc }));
  return { orders };
}

async function confirmMemberOrder(openid, orderId) {
  if (!orderId) {
    throw new Error('缺少订单编号');
  }
  let experienceGain = 0;
  let stoneReward = 0;
  let orderSnapshot = null;
  await Promise.all([
    ensureCollection(COLLECTIONS.MENU_ORDERS),
    ensureCollection(COLLECTIONS.WALLET_TRANSACTIONS),
    ensureCollection(COLLECTIONS.CHARGE_ORDERS),
    ensureCollection(COLLECTIONS.STONE_TRANSACTIONS)
  ]);
  try {
    await db.runTransaction(async (transaction) => {
      const orderRef = transaction.collection(COLLECTIONS.MENU_ORDERS).doc(orderId);
      const snapshot = await orderRef.get().catch(() => null);
      if (!snapshot || !snapshot.data) {
        throw new Error('订单不存在');
      }
      const order = snapshot.data;
      if (order.memberId !== openid) {
        throw new Error('无法操作该订单');
      }
      if (order.status !== 'pendingMember') {
        throw new Error('订单当前不可确认');
      }
      const amount = Number(order.totalAmount || 0);
      if (!Number.isFinite(amount) || amount < 0) {
        throw new Error('订单金额无效');
      }
      const now = new Date();
      const memberRef = transaction.collection(COLLECTIONS.MEMBERS).doc(openid);
      const memberDoc = await memberRef.get().catch(() => null);
      if (!memberDoc || !memberDoc.data) {
        throw new Error('会员不存在');
      }
      const memberSnapshot = buildMemberSnapshot(memberDoc.data);
      let chargeOrderId = order.chargeOrderId || '';
      let chargeOrderDoc = null;
      if (amount > 0) {
        const ensured = await ensureChargeOrderForMenuOrder(
          transaction,
          orderId,
          order,
          order.adminId || openid,
          now
        );
        chargeOrderId = ensured.id || chargeOrderId;
        chargeOrderDoc = ensured.order;
        const balance = resolveCashBalance(memberDoc.data);
        if (balance < amount) {
          throw createCustomError(ERROR_CODES.INSUFFICIENT_FUNDS, '余额不足，请先充值');
        }
        stoneReward = resolveChargeStoneReward(chargeOrderDoc, amount);
        experienceGain = calculateExperienceGain(amount);
        await memberRef.update({
          data: {
            cashBalance: _.inc(-amount),
            totalSpend: _.inc(amount),
            stoneBalance: _.inc(stoneReward),
            updatedAt: now,
            ...(experienceGain > 0 ? { experience: _.inc(experienceGain) } : {})
          }
        });
        const normalizedChargeOrderId =
          typeof chargeOrderId === 'string' ? chargeOrderId.trim() : chargeOrderId ? String(chargeOrderId) : '';
        const walletTransactionData = {
          memberId: openid,
          amount: -amount,
          type: 'spend',
          status: 'success',
          source: 'menuOrder',
          orderId: normalizedChargeOrderId || orderId,
          remark: '菜单消费',
          createdAt: now,
          updatedAt: now
        };
        if (orderId) {
          walletTransactionData.menuOrderId = orderId;
        }
        if (normalizedChargeOrderId) {
          walletTransactionData.chargeOrderId = normalizedChargeOrderId;
        }
        await transaction.collection(COLLECTIONS.WALLET_TRANSACTIONS).add({
          data: walletTransactionData
        });
        await transaction.collection(COLLECTIONS.STONE_TRANSACTIONS).add({
          data: {
            memberId: openid,
            amount: stoneReward,
            type: 'earn',
            source: 'menuOrder',
            description: '菜单消费赠送灵石',
            createdAt: now,
            meta: {
              orderId,
              chargeOrderId: chargeOrderId || ensured.id || ''
            }
          }
        });
        if (chargeOrderId) {
          await transaction.collection(COLLECTIONS.CHARGE_ORDERS).doc(chargeOrderId).update({
            data: {
              status: 'paid',
              memberId: openid,
              memberSnapshot,
              confirmedAt: now,
              stoneReward,
              updatedAt: now,
              menuOrderId: orderId
            }
          });
        }
      } else {
        chargeOrderId = '';
      }
      await orderRef.update({
        data: {
          status: 'paid',
          memberConfirmedAt: now,
          updatedAt: now,
          chargeOrderId,
          memberSnapshot
        }
      });
      const appliedRights = Array.isArray(order.appliedRights) ? order.appliedRights : [];
      for (const applied of appliedRights) {
        const memberRightId = applied && typeof applied.memberRightId === 'string' ? applied.memberRightId.trim() : '';
        if (!memberRightId) {
          continue;
        }
        const rightRef = transaction.collection(COLLECTIONS.MEMBER_RIGHTS).doc(memberRightId);
        const rightSnapshot = await rightRef.get().catch(() => null);
        if (!rightSnapshot || !rightSnapshot.data) {
          continue;
        }
        const previousMeta = rightSnapshot.data.meta || {};
        const redemptionType =
          applied.type ||
          (applied.rightId === DRINK_VOUCHER_RIGHT_ID
            ? 'drinkVoucher'
            : applied.rightId === CUBANEY_VOUCHER_RIGHT_ID
            ? 'cubaneyVoucher'
            : 'voucher');
        await rightRef.update({
          data: {
            status: 'used',
            usedAt: now,
            updatedAt: now,
            orderId,
            meta: {
              ...previousMeta,
              redeemedFor: redemptionType,
              redeemedAmount: Number(applied.amount || 0),
              redeemedOrderId: orderId
            }
          }
        });
      }
      orderSnapshot = mapOrder({
        _id: orderId,
        ...order,
        status: 'paid',
        memberConfirmedAt: now,
        updatedAt: now,
        chargeOrderId,
        memberSnapshot
      });
    });
  } catch (error) {
    if (isCustomError(error, ERROR_CODES.INSUFFICIENT_FUNDS)) {
      return {
        errorCode: ERROR_CODES.INSUFFICIENT_FUNDS,
        message: '余额不足，请先充值'
      };
    }
    throw error;
  }
  if (experienceGain > 0) {
    await syncMemberLevel(openid);
  }
  return { order: orderSnapshot, experienceGain, stoneReward };
}

async function cancelOrder(openid, orderId, remarkInput = '') {
  await ensureAdmin(openid);
  return cancelMenuOrder(openid, orderId, remarkInput, { role: 'admin' });
}

async function cancelMemberOrder(openid, orderId, remarkInput = '') {
  return cancelMenuOrder(openid, orderId, remarkInput, { role: 'member' });
}

async function cancelMenuOrder(actorId, orderId, remarkInput = '', { role } = {}) {
  if (!orderId) {
    throw new Error('缺少订单编号');
  }
  const normalizedRole = role === 'admin' ? 'admin' : 'member';
  const remark = normalizeRemark(remarkInput, 200);
  const now = new Date();
  let orderSnapshot = null;
  await Promise.all([
    ensureCollection(COLLECTIONS.MENU_ORDERS),
    ensureCollection(COLLECTIONS.CHARGE_ORDERS)
  ]);
  await db.runTransaction(async (transaction) => {
    const orderRef = transaction.collection(COLLECTIONS.MENU_ORDERS).doc(orderId);
    const snapshot = await orderRef.get().catch(() => null);
    if (!snapshot || !snapshot.data) {
      throw new Error('订单不存在');
    }
    const order = snapshot.data;
    if (order.status === 'paid') {
      throw new Error('订单已完成，无法取消');
    }
    if (order.status === 'cancelled') {
      orderSnapshot = mapOrder({ _id: orderId, ...order });
      return;
    }
    if (normalizedRole === 'member') {
      if (order.memberId !== actorId) {
        throw new Error('无法操作该订单');
      }
      if (order.status !== 'pendingMember') {
        throw new Error('订单当前不可取消');
      }
    } else if (!['submitted', 'pendingMember'].includes(order.status)) {
      throw new Error('订单当前不可取消');
    }
    const cancelRemark = remark || (normalizedRole === 'admin' ? '管理员取消订单' : '会员取消订单');
    const cancelReason = normalizedRole === 'admin' ? 'adminCancelled' : 'memberCancelled';
    const updates = {
      status: 'cancelled',
      cancelledAt: now,
      cancelledBy: actorId,
      cancelledByRole: normalizedRole,
      cancelRemark,
      cancelReason,
      updatedAt: now
    };
    await orderRef.update({ data: updates });
    const appliedRights = Array.isArray(order.appliedRights) ? order.appliedRights : [];
    for (const applied of appliedRights) {
      const memberRightId = applied && typeof applied.memberRightId === 'string' ? applied.memberRightId.trim() : '';
      if (!memberRightId) {
        continue;
      }
      await transaction
        .collection(COLLECTIONS.MEMBER_RIGHTS)
        .doc(memberRightId)
        .update({
          data: {
            status: 'active',
            updatedAt: now,
            orderId: _.remove(),
            lockedAt: _.remove(),
            usedAt: _.remove()
          }
        })
        .catch(() => null);
    }
    const chargeOrderId = typeof order.chargeOrderId === 'string' ? order.chargeOrderId.trim() : '';
    if (chargeOrderId) {
      const chargeOrderRef = transaction.collection(COLLECTIONS.CHARGE_ORDERS).doc(chargeOrderId);
      const chargeSnapshot = await chargeOrderRef.get().catch(() => null);
      if (chargeSnapshot && chargeSnapshot.data) {
        await chargeOrderRef
          .update({
            data: {
              status: 'cancelled',
              updatedAt: now,
              cancelRemark,
              cancelledBy: actorId,
              cancelledByRole: normalizedRole
            }
          })
          .catch(() => null);
      }
    }
    orderSnapshot = mapOrder({ _id: orderId, ...order, ...updates });
  });
  return { order: orderSnapshot };
}

async function ensureMember(openid) {
  if (!openid) {
    throw new Error('未获取到用户身份');
  }
  const snapshot = await db.collection(COLLECTIONS.MEMBERS).doc(openid).get().catch(() => null);
  if (!snapshot || !snapshot.data) {
    throw new Error('会员不存在');
  }
  return { _id: openid, ...snapshot.data };
}

async function ensureAdmin(openid) {
  const member = await ensureMember(openid);
  const roles = Array.isArray(member.roles) ? member.roles : [];
  const hasAdminRole = roles.some((role) => ADMIN_ROLES.includes(role));
  if (!hasAdminRole) {
    throw new Error('无权访问该功能');
  }
  return member;
}

function isMemberRightExpired(right, now = new Date()) {
  if (!right || !right.validUntil) {
    return false;
  }
  const expiry = new Date(right.validUntil).getTime();
  if (!Number.isFinite(expiry)) {
    return false;
  }
  return expiry < now.getTime();
}

function resolveDrinkVoucherCandidate(items, limit = DRINK_VOUCHER_AMOUNT_LIMIT, category = 'drinks') {
  if (!Array.isArray(items) || !items.length) {
    return null;
  }
  let targetIndex = -1;
  let highestPrice = -1;
  items.forEach((item, index) => {
    if (!item) {
      return;
    }
    const section = normalizeCategoryType(item.categoryType);
    if (section !== category) {
      return;
    }
    const price = Number(item.price || 0);
    const quantity = Math.max(1, Math.floor(Number(item.quantity || 0)));
    const amount = Number(item.amount || price * quantity);
    if (
      !Number.isFinite(price) ||
      price <= 0 ||
      price > limit ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return;
    }
    if (price > highestPrice) {
      highestPrice = price;
      targetIndex = index;
    }
  });
  if (targetIndex < 0) {
    return null;
  }
  const target = items[targetIndex];
  const price = Number(target.price || 0);
  const quantity = Math.max(1, Math.floor(Number(target.quantity || 0)));
  const amount = Number(target.amount || price * quantity);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  const discount = Math.min(limit, price, amount);
  if (discount <= 0) {
    return null;
  }
  return { index: targetIndex, discount, price, quantity, categoryType: normalizeCategoryType(target.categoryType) };
}

function resolveCubaneyVoucherCandidate(items, voucherAmount = CUBANEY_VOUCHER_AMOUNT) {
  if (!Array.isArray(items) || !items.length) {
    return null;
  }
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) {
      continue;
    }
    const category = normalizeCategoryType(item.categoryType);
    if (category !== 'drinks') {
      continue;
    }
    const menuId = typeof item.menuId === 'string' ? item.menuId.trim().toLowerCase() : '';
    const itemId = typeof item.itemId === 'string' ? item.itemId.trim().toLowerCase() : '';
    const title = typeof item.title === 'string' ? item.title : '';
    const spec = typeof item.spec === 'string' ? item.spec.trim() : '';
    const matchedMenu = CUBANEY_MENU_IDS.some((id) =>
      id === menuId ||
      id === itemId ||
      (menuId && menuId.endsWith(id)) ||
      (itemId && itemId.endsWith(id))
    );
    const matchedTitle = CUBANEY_TITLE_KEYWORDS.some((keyword) => title.includes(keyword));
    if (!matchedMenu && !matchedTitle) {
      continue;
    }
    if (spec && !/瓶/.test(spec)) {
      continue;
    }
    const price = Number(item.price || 0);
    const quantity = Math.max(1, Math.floor(Number(item.quantity || 0)));
    const amount = Number(item.amount || price * quantity);
    if (!Number.isFinite(price) || !Number.isFinite(amount) || price <= 0 || amount <= 0) {
      continue;
    }
    if (price < voucherAmount && amount < voucherAmount) {
      continue;
    }
    const discount = Math.min(voucherAmount, amount);
    if (discount <= 0) {
      continue;
    }
    return { index, discount, price, quantity, amount, categoryType: category };
  }
  return null;
}

async function lockDrinkVoucherRight(transaction, memberId, now = new Date()) {
  if (!memberId) {
    return null;
  }
  let snapshot;
  try {
    snapshot = await transaction
      .collection(COLLECTIONS.MEMBER_RIGHTS)
      .where({ memberId, rightId: DRINK_VOUCHER_RIGHT_ID, status: 'active' })
      .orderBy('issuedAt', 'asc')
      .limit(5)
      .get();
  } catch (error) {
    if (isCollectionNotFoundError(error)) {
      return null;
    }
    throw error;
  }
  const candidates = Array.isArray(snapshot.data) ? snapshot.data : [];
  const usable = candidates.find((entry) => !isMemberRightExpired(entry, now));
  if (!usable) {
    return null;
  }
  let title = '任意饮品券（120 元内）';
  try {
    const masterSnapshot = await transaction
      .collection(COLLECTIONS.MEMBERSHIP_RIGHTS)
      .doc(DRINK_VOUCHER_RIGHT_ID)
      .get();
    if (masterSnapshot && masterSnapshot.data && masterSnapshot.data.name) {
      title = masterSnapshot.data.name;
    }
  } catch (error) {
    if (!isCollectionNotFoundError(error)) {
      throw error;
    }
  }
  const docId = typeof usable._id === 'string' ? usable._id : typeof usable.id === 'string' ? usable.id : '';
  if (!docId) {
    return null;
  }
  return { ...usable, _id: docId, title };
}

async function lockCubaneyVoucherRight(transaction, memberId, now = new Date()) {
  if (!memberId) {
    return null;
  }
  let snapshot;
  try {
    snapshot = await transaction
      .collection(COLLECTIONS.MEMBER_RIGHTS)
      .where({ memberId, rightId: CUBANEY_VOUCHER_RIGHT_ID, status: 'active' })
      .orderBy('issuedAt', 'asc')
      .limit(5)
      .get();
  } catch (error) {
    if (isCollectionNotFoundError(error)) {
      return null;
    }
    throw error;
  }
  const candidates = Array.isArray(snapshot.data) ? snapshot.data : [];
  const usable = candidates.find((entry) => !isMemberRightExpired(entry, now));
  if (!usable) {
    return null;
  }
  let title = '古巴邑 10 年兑换券';
  try {
    const masterSnapshot = await transaction
      .collection(COLLECTIONS.MEMBERSHIP_RIGHTS)
      .doc(CUBANEY_VOUCHER_RIGHT_ID)
      .get();
    if (masterSnapshot && masterSnapshot.data && masterSnapshot.data.name) {
      title = masterSnapshot.data.name;
    }
  } catch (error) {
    if (!isCollectionNotFoundError(error)) {
      throw error;
    }
  }
  const docId = typeof usable._id === 'string' ? usable._id : typeof usable.id === 'string' ? usable.id : '';
  if (!docId) {
    return null;
  }
  return { ...usable, _id: docId, title };
}

function normalizeRemark(value, limit = 140) {
  if (!value) {
    return '';
  }
  const text = String(value).trim();
  if (!text) {
    return '';
  }
  return text.slice(0, limit);
}

function normalizeCategoryType(value) {
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    if (CATEGORY_TYPES.includes(normalized)) {
      return normalized;
    }
  }
  return 'drinks';
}

function normalizeCategoryTotals(input) {
  const totals = {};
  CATEGORY_TYPES.forEach((type) => {
    totals[type] = 0;
  });
  if (input && typeof input === 'object') {
    CATEGORY_TYPES.forEach((type) => {
      const value = Math.round(Number(input[type] || 0));
      totals[type] = Number.isFinite(value) && value > 0 ? value : 0;
    });
  }
  return totals;
}

function normalizeAdminPriceAdjustment(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }
  const previousAmount = Number(record.previousAmount || record.previous || 0);
  const newAmount = Number(record.newAmount || record.current || record.amount || 0);
  if (!newAmount || newAmount <= 0) {
    return null;
  }
  const remark = typeof record.remark === 'string' ? record.remark : '';
  const adjustedAt = record.adjustedAt || record.updatedAt || record.createdAt || null;
  const adjustedBy = typeof record.adjustedBy === 'string' ? record.adjustedBy : '';
  return {
    previousAmount,
    newAmount,
    remark,
    adjustedAt,
    adjustedBy,
    adjustedByName: typeof record.adjustedByName === 'string' ? record.adjustedByName : ''
  };
}

function normalizeAdminPriceAdjustmentHistory(history, latestRaw) {
  const latest = normalizeAdminPriceAdjustment(latestRaw);
  if (!Array.isArray(history)) {
    return latest ? [latest] : [];
  }
  const normalized = history.map((entry) => normalizeAdminPriceAdjustment(entry)).filter(Boolean);
  if (latest) {
    const [first] = normalized;
    if (!first || first.adjustedAt !== latest.adjustedAt || first.newAmount !== latest.newAmount) {
      normalized.unshift(latest);
    }
  }
  return normalized;
}

function normalizeItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  const result = [];
  for (const item of items) {
    if (!item) continue;
    const menuId = typeof item.menuId === 'string' ? item.menuId.trim() : '';
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    const spec = typeof item.spec === 'string' ? item.spec.trim() : '';
    const unit = typeof item.unit === 'string' ? item.unit.trim() : '';
    const price = Math.round(Number(item.price || 0));
    const quantity = Math.max(1, Math.floor(Number(item.quantity || 0)));
    if (!menuId || !title || !Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
      continue;
    }
    const amount = price * quantity;
    const categoryType = normalizeCategoryType(item.categoryType);
    result.push({
      menuId,
      title,
      spec,
      unit,
      price,
      quantity,
      amount,
      categoryType
    });
    if (result.length >= 50) {
      break;
    }
  }
  return result;
}

function mapOrder(doc) {
  if (!doc) {
    return null;
  }
  const items = Array.isArray(doc.items)
    ? doc.items.map((item) => ({
        menuId: item.menuId || '',
        title: item.title || '',
        spec: item.spec || '',
        unit: item.unit || '',
        price: Number(item.price || 0),
        quantity: Number(item.quantity || 0),
        amount: Number(item.amount || 0),
        discount: Number(item.discount || 0),
        categoryType: normalizeCategoryType(item.categoryType)
      }))
    : [];
  const appliedRights = Array.isArray(doc.appliedRights)
    ? doc.appliedRights.map((entry) => ({
        memberRightId: entry.memberRightId || '',
        rightId: entry.rightId || '',
        amount: Number(entry.amount || 0),
        type: entry.type || '',
        title: entry.title || entry.name || ''
      }))
    : [];
  return {
    _id: doc._id || doc.id || '',
    status: doc.status || 'submitted',
    items,
    totalAmount: Number(doc.totalAmount || 0),
    originalTotalAmount: Number(doc.originalTotalAmount || 0),
    discountTotal: Number(doc.discountTotal || 0),
    appliedRights,
    drinkVoucherApplied:
      doc.drinkVoucherApplied === true ||
      appliedRights.some((entry) => entry.type === 'drinkVoucher' || entry.rightId === DRINK_VOUCHER_RIGHT_ID),
    cubaneyVoucherApplied:
      doc.cubaneyVoucherApplied === true ||
      appliedRights.some(
        (entry) => entry.type === 'cubaneyVoucher' || entry.rightId === CUBANEY_VOUCHER_RIGHT_ID
      ),
    categoryTotals: normalizeCategoryTotals(doc.categoryTotals),
    remark: doc.remark || '',
    adminRemark: doc.adminRemark || '',
    adminPriceAdjustment: normalizeAdminPriceAdjustment(doc.adminPriceAdjustment),
    adminPriceAdjustmentHistory: normalizeAdminPriceAdjustmentHistory(
      doc.adminPriceAdjustmentHistory,
      doc.adminPriceAdjustment
    ),
    memberId: doc.memberId || '',
    memberSnapshot: doc.memberSnapshot || {},
    adminSnapshot: doc.adminSnapshot || {},
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
    adminConfirmedAt: doc.adminConfirmedAt || null,
    memberConfirmedAt: doc.memberConfirmedAt || null,
    chargeOrderId: doc.chargeOrderId || '',
    cancelRemark: doc.cancelRemark || '',
    cancelReason: doc.cancelReason || '',
    cancelledAt: doc.cancelledAt || null,
    cancelledBy: doc.cancelledBy || '',
    cancelledByRole: doc.cancelledByRole || ''
  };
}

function calculateExperienceGain(amountFen) {
  if (!amountFen || amountFen <= 0) {
    return 0;
  }
  return Math.max(0, Math.round((amountFen * EXPERIENCE_PER_YUAN) / 100));
}

function buildChargeItemsFromMenuOrder(order) {
  const adjustment = normalizeAdminPriceAdjustment(order && order.adminPriceAdjustment);
  if (adjustment) {
    const amount = Number(adjustment.newAmount || adjustment.amount || 0);
    if (Number.isFinite(amount) && amount > 0) {
      return [
        {
          name: '菜单消费（改价）',
          price: amount,
          quantity: 1,
          amount
        }
      ];
    }
  }
  if (!order || !Array.isArray(order.items)) {
    const fallback = Number(order && order.totalAmount ? order.totalAmount : 0);
    return fallback > 0
      ? [
          {
            name: '菜单消费',
            price: fallback,
            quantity: 1,
            amount: fallback
          }
        ]
      : [];
  }
  const result = order.items
    .map((item) => {
      if (!item) return null;
      const title = typeof item.title === 'string' ? item.title.trim() : '';
      const spec = typeof item.spec === 'string' ? item.spec.trim() : '';
      const quantity = Math.max(1, Math.floor(Number(item.quantity || 0)));
      const price = Number(item.price || 0);
      const amount = Number.isFinite(item.amount) ? Number(item.amount) : price * quantity;
      const nameParts = [title];
      if (spec) {
        nameParts.push(spec);
      }
      const name = nameParts.filter(Boolean).join(' - ') || title;
      if (!name || !Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
        return null;
      }
      const resolvedAmount = Number.isFinite(amount) && amount > 0 ? amount : price * quantity;
      if (!resolvedAmount || resolvedAmount <= 0) {
        return null;
      }
      return {
        name,
        price,
        quantity,
        amount: resolvedAmount
      };
    })
    .filter(Boolean);
  if (!result.length) {
    const fallback = Number(order.totalAmount || 0);
    if (fallback > 0) {
      result.push({
        name: '菜单消费',
        price: fallback,
        quantity: 1,
        amount: fallback
      });
    }
  }
  return result;
}

function buildMemberSnapshot(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      nickName: '',
      realName: '',
      mobile: '',
      levelId: ''
    };
  }
  return {
    nickName: typeof raw.nickName === 'string' ? raw.nickName : '',
    realName: typeof raw.realName === 'string' ? raw.realName : '',
    mobile: typeof raw.mobile === 'string' ? raw.mobile : '',
    levelId: typeof raw.levelId === 'string' ? raw.levelId : ''
  };
}

function resolveChargeStoneReward(chargeOrder, fallbackAmount) {
  if (chargeOrder && Number(chargeOrder.stoneReward) > 0) {
    return Number(chargeOrder.stoneReward);
  }
  if (chargeOrder && Number(chargeOrder.totalAmount) > 0) {
    return Number(chargeOrder.totalAmount);
  }
  const amount = Number(fallbackAmount || 0);
  return amount > 0 ? amount : 0;
}

function resolveCashBalance(member) {
  if (!member) return 0;
  if (Object.prototype.hasOwnProperty.call(member, 'cashBalance')) {
    const resolved = resolveAmountNumber(member.cashBalance);
    if (Number.isFinite(resolved)) {
      return resolved;
    }
  }
  if (Object.prototype.hasOwnProperty.call(member, 'balance')) {
    const legacy = resolveAmountNumber(member.balance);
    if (Number.isFinite(legacy)) {
      return legacy;
    }
  }
  return 0;
}

function resolveAmountNumber(value) {
  if (value == null) return 0;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'object') {
    if (typeof value.toNumber === 'function') {
      try {
        const numeric = value.toNumber();
        return Number.isFinite(numeric) ? numeric : 0;
      } catch (err) {
        // fall through
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
  return Number.isFinite(numeric) ? numeric : 0;
}

async function syncMemberLevel(openid) {
  const memberPromise = db.collection(COLLECTIONS.MEMBERS).doc(openid).get().catch(() => null);
  const levelsPromise = db
    .collection(COLLECTIONS.MEMBERSHIP_LEVELS)
    .orderBy('order', 'asc')
    .get()
    .catch((error) => {
      if (isCollectionNotFoundError(error)) {
        return { data: [] };
      }
      throw error;
    });
  const [memberDoc, levelsSnapshot] = await Promise.all([memberPromise, levelsPromise]);
  if (!memberDoc || !memberDoc.data) return;
  const member = memberDoc.data;
  const levels = levelsSnapshot.data || [];
  if (!levels.length) return;

  const {
    levelId: resolvedLevelId,
    pendingBreakthroughLevelId,
    levelsToGrant
  } = analyzeMemberLevelProgress(member, levels);

  const updates = {};
  const normalizedPending = pendingBreakthroughLevelId || '';
  const existingPending =
    typeof member.pendingBreakthroughLevelId === 'string' ? member.pendingBreakthroughLevelId : '';

  if (resolvedLevelId && resolvedLevelId !== member.levelId) {
    updates.levelId = resolvedLevelId;
  }

  if (normalizedPending !== existingPending) {
    updates.pendingBreakthroughLevelId = normalizedPending;
  }

  if (Object.keys(updates).length) {
    updates.updatedAt = new Date();
    await db
      .collection(COLLECTIONS.MEMBERS)
      .doc(openid)
      .update({
        data: updates
      })
      .catch(() => null);
  }

  for (const level of levelsToGrant) {
    await grantLevelRewards(openid, level);
  }
}

async function grantLevelRewards(openid, level) {
  const rewards = level.rewards || [];
  if (!rewards.length) return;
  const masterSnapshot = await db
    .collection(COLLECTIONS.MEMBERSHIP_RIGHTS)
    .get()
    .catch((error) => {
      if (isCollectionNotFoundError(error)) {
        return { data: [] };
      }
      throw error;
    });
  const masterMap = {};
  (masterSnapshot.data || []).forEach((item) => {
    masterMap[item._id] = item;
  });
  const rightsCollection = db.collection(COLLECTIONS.MEMBER_RIGHTS);
  const now = new Date();
  for (const reward of rewards) {
    const right = masterMap[reward.rightId];
    if (!right) continue;
    const existing = await rightsCollection
      .where({ memberId: openid, rightId: reward.rightId, levelId: level._id })
      .count()
      .catch((error) => {
        if (isCollectionNotFoundError(error)) {
          return { total: 0 };
        }
        throw error;
      });
    const quantity = reward.quantity || 1;
    if (existing.total >= quantity) continue;
    const validUntil = right.validDays
      ? new Date(now.getTime() + right.validDays * 24 * 60 * 60 * 1000)
      : null;
    for (let i = existing.total; i < quantity; i += 1) {
      await rightsCollection.add({
        data: {
          memberId: openid,
          rightId: reward.rightId,
          levelId: level._id,
          status: 'active',
          issuedAt: now,
          validUntil,
          meta: {
            fromLevel: level._id,
            rewardName: reward.description || right.name
          }
        }
      });
    }
  }
}
