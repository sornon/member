const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { COLLECTIONS, TRADING_CONFIG } = require('common-config');
const { createProxyHelpers } = require('admin-proxy');

const db = cloud.database();
const _ = db.command;

const proxyHelpers = createProxyHelpers(cloud, { loggerTag: 'trading' });

const LISTING_COLLECTION = COLLECTIONS.TRADE_LISTINGS || 'tradeListings';
const ORDER_COLLECTION = COLLECTIONS.TRADE_ORDERS || 'tradeOrders';
const BID_COLLECTION = COLLECTIONS.TRADE_BIDS || 'tradeBids';
const METRIC_COLLECTION = COLLECTIONS.TRADE_METRICS || 'tradeMetrics';
const MEMBERS_COLLECTION = COLLECTIONS.MEMBERS || 'members';
const STONE_COLLECTION = COLLECTIONS.STONE_TRANSACTIONS || 'stoneTransactions';

const SALE_MODES = Object.freeze(['fixed', 'auction']);
const LISTING_STATUS = Object.freeze({
  ACTIVE: 'active',
  SOLD: 'sold',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  SETTLED: 'settled'
});
const BID_STATUS = Object.freeze({
  ACTIVE: 'active',
  OUTBID: 'outbid',
  REFUNDED: 'refunded',
  WON: 'won',
  SETTLED: 'settled'
});

const DEFAULT_LISTING_DURATION_HOURS = 72;
const MAX_LISTING_FETCH = 50;
const MAX_SELLABLE_ITEMS = 100;
const MAX_BID_HISTORY = 20;

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

const ensuredCollections = new Set();

function isCollectionNotExistsError(error) {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = typeof error.errCode !== 'undefined' ? error.errCode : error.code;
  const message = typeof error.errMsg === 'string' ? error.errMsg : error.message || '';
  return code === -502005 || /collection\s+not\s+exist|database collection not exists|ResourceNotFound/i.test(message);
}

function isCollectionAlreadyExistsError(error) {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = typeof error.errCode !== 'undefined' ? error.errCode : error.code;
  const message = typeof error.errMsg === 'string' ? error.errMsg : error.message || '';
  return code === -502004 || /already\s+exist/i.test(message);
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
    return;
  } catch (error) {
    if (!isCollectionNotExistsError(error)) {
      ensuredCollections.add(name);
      return;
    }
  }
  if (typeof db.createCollection !== 'function') {
    throw new Error(`缺少集合 ${name}，且当前环境不支持自动创建。`);
  }
  try {
    await db.createCollection(name);
    ensuredCollections.add(name);
  } catch (error) {
    if (isCollectionAlreadyExistsError(error)) {
      ensuredCollections.add(name);
      return;
    }
    throw error;
  }
}

function createError(code, message) {
  const error = new Error(message || '发生未知错误');
  error.code = code;
  error.errCode = code;
  error.errMsg = message || '发生未知错误';
  return error;
}

function resolveServerDate() {
  return typeof db.serverDate === 'function' ? db.serverDate() : new Date();
}

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  if (numeric < min) {
    return min;
  }
  if (numeric > max) {
    return max;
  }
  return numeric;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(fallback, Math.floor(numeric));
}

function normalizeSaleMode(mode) {
  if (typeof mode !== 'string') {
    return 'fixed';
  }
  const normalized = mode.trim().toLowerCase();
  return SALE_MODES.includes(normalized) ? normalized : 'fixed';
}

function normalizeDurationHours(hours) {
  const minHours = Math.max(1, TRADING_CONFIG.minDurationHours || 24);
  const maxHours = Math.max(minHours, TRADING_CONFIG.maxDurationHours || 168);
  const numeric = Number(hours);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_LISTING_DURATION_HOURS;
  }
  const clamped = clamp(Math.floor(numeric), minHours, maxHours);
  return clamped;
}

function resolveBidIncrement(basePrice, incrementInput) {
  const minIncrementRate = Math.max(0.01, TRADING_CONFIG.minBidIncrementRate || 0.05);
  const minIncrement = Math.max(1, Math.floor(basePrice * minIncrementRate));
  const provided = Number(incrementInput);
  if (!Number.isFinite(provided) || provided <= 0) {
    return minIncrement;
  }
  return Math.max(minIncrement, Math.floor(provided));
}

function sanitizeEquipmentEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const itemId = typeof entry.itemId === 'string' ? entry.itemId.trim() : '';
  if (!itemId) {
    return null;
  }
  const inventoryId = typeof entry.inventoryId === 'string' ? entry.inventoryId.trim() : '';
  const level = toPositiveInt(entry.level || 1, 1);
  const refine = toPositiveInt(entry.refine || 0, 0);
  const quality = typeof entry.quality === 'string' ? entry.quality : 'mortal';
  const favorite = !!entry.favorite;
  const obtainedAt = entry.obtainedAt || null;
  return {
    inventoryId,
    itemId,
    level,
    refine,
    quality,
    favorite,
    obtainedAt
  };
}

function buildEquipmentSummary(entry) {
  const sanitized = sanitizeEquipmentEntry(entry);
  if (!sanitized) {
    return null;
  }
  return {
    inventoryId: sanitized.inventoryId,
    itemId: sanitized.itemId,
    level: sanitized.level,
    refine: sanitized.refine,
    quality: sanitized.quality,
    favorite: sanitized.favorite,
    obtainedAt: sanitized.obtainedAt || null
  };
}

function resolveMemberDisplayName(member) {
  if (!member || typeof member !== 'object') {
    return '无名仙友';
  }
  if (typeof member.nickName === 'string' && member.nickName.trim()) {
    return member.nickName.trim();
  }
  if (typeof member.name === 'string' && member.name.trim()) {
    return member.name.trim();
  }
  return '无名仙友';
}

function resolveStoneBalance(member) {
  if (!member || typeof member !== 'object') {
    return 0;
  }
  const numeric = Number(member.stoneBalance);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.floor(numeric));
}

function buildListingResponse(listing, currentMemberId) {
  if (!listing || typeof listing !== 'object') {
    return null;
  }
  const item = buildEquipmentSummary(listing.itemSnapshot);
  const bids = Array.isArray(listing.bidHistory) ? listing.bidHistory.slice(0, MAX_BID_HISTORY) : [];
  return {
    id: listing._id,
    saleMode: listing.saleMode,
    status: listing.status,
    sellerId: listing.sellerId,
    sellerName: listing.sellerName,
    fixedPrice: listing.fixedPrice || null,
    startPrice: listing.startPrice || null,
    currentPrice: listing.currentPrice || null,
    buyoutPrice: listing.buyoutPrice || null,
    bidIncrement: listing.bidIncrement || null,
    expiresAt: listing.expiresAt || null,
    createdAt: listing.createdAt || null,
    updatedAt: listing.updatedAt || null,
    soldAt: listing.soldAt || null,
    buyerId: listing.buyerId || '',
    buyerName: listing.buyerName || '',
    youAreSeller: currentMemberId ? listing.sellerId === currentMemberId : false,
    youAreHighestBidder: currentMemberId ? listing.currentBidderId === currentMemberId : false,
    bidCount: listing.bidCount || 0,
    item,
    bids,
    allowBuyout: listing.status === LISTING_STATUS.ACTIVE &&
      ((listing.saleMode === 'fixed' && listing.fixedPrice > 0) ||
        (listing.saleMode === 'auction' && listing.buyoutPrice > 0)),
    allowBid:
      listing.status === LISTING_STATUS.ACTIVE &&
      listing.saleMode === 'auction' &&
      (!listing.currentPrice || !listing.buyoutPrice || listing.currentPrice < listing.buyoutPrice)
  };
}

function buildBidResponse(bid, currentMemberId) {
  if (!bid || typeof bid !== 'object') {
    return null;
  }
  return {
    id: bid._id,
    listingId: bid.listingId,
    amount: bid.amount,
    status: bid.status,
    createdAt: bid.createdAt || null,
    updatedAt: bid.updatedAt || null,
    isOwner: currentMemberId ? bid.bidderId === currentMemberId : false
  };
}

async function settleExpiredListings(now = new Date()) {
  const limit = 10;
  await ensureCollection(LISTING_COLLECTION);
  const expiredSnapshot = await db
    .collection(LISTING_COLLECTION)
    .where({
      status: LISTING_STATUS.ACTIVE,
      expiresAt: _.lte(now)
    })
    .limit(limit)
    .get();
  const expired = expiredSnapshot.data || [];
  const tasks = expired.map((doc) => finalizeExpiredListing(doc, now));
  if (tasks.length) {
    await Promise.allSettled(tasks);
  }
}

async function finalizeExpiredListing(listingDoc, now = new Date()) {
  if (!listingDoc || listingDoc.status !== LISTING_STATUS.ACTIVE) {
    return;
  }
  await db.runTransaction(async (transaction) => {
    const listingRef = transaction.collection(LISTING_COLLECTION).doc(listingDoc._id);
    const fresh = await listingRef.get();
    if (!fresh || !fresh.data) {
      return;
    }
    const listing = fresh.data;
    if (listing.status !== LISTING_STATUS.ACTIVE) {
      return;
    }
    const expiresAt = listing.expiresAt ? new Date(listing.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() > now.getTime()) {
      return;
    }
    if (listing.saleMode === 'auction' && listing.currentBidderId && listing.currentPrice > 0) {
      await completeSale(transaction, listing, {
        buyerId: listing.currentBidderId,
        buyerName: listing.currentBidderName || '神秘道友',
        price: listing.currentPrice,
        source: 'auction',
        bidId: listing.currentBidId || ''
      });
      return;
    }
    await restoreListingItem(transaction, listing);
    await listingRef.update({
      data: {
        status: LISTING_STATUS.EXPIRED,
        updatedAt: resolveServerDate()
      }
    });
  });
}

async function restoreListingItem(transaction, listing) {
  if (!listing || !listing.sellerId || !listing.itemSnapshot) {
    return;
  }
  const item = sanitizeEquipmentEntry(listing.itemSnapshot);
  if (!item || !item.itemId) {
    return;
  }
  const updates = {
    'pveProfile.equipment.inventory': _.push([item]),
    updatedAt: resolveServerDate()
  };
  await transaction.collection(MEMBERS_COLLECTION).doc(listing.sellerId).update({
    data: updates
  });
}

async function completeSale(transaction, listing, options = {}) {
  if (!listing || !listing.itemSnapshot) {
    throw createError('LISTING_INVALID', '无法结算该交易');
  }
  const price = Math.max(1, Math.floor(Number(options.price) || 0));
  const sellerId = listing.sellerId;
  const buyerId = options.buyerId;
  if (!sellerId || !buyerId) {
    throw createError('MEMBER_REQUIRED', '交易双方信息缺失');
  }
  if (sellerId === buyerId) {
    throw createError('SELF_PURCHASE_FORBIDDEN', '不可购买自己的装备');
  }
  const saleMode = listing.saleMode;
  const now = resolveServerDate();
  const feeRate = typeof TRADING_CONFIG.feeRate === 'number' ? TRADING_CONFIG.feeRate : 0.05;
  const fee = Math.max(0, Math.floor(price * feeRate));
  const sellerIncome = Math.max(0, price - fee);

  const sellerRef = transaction.collection(MEMBERS_COLLECTION).doc(sellerId);
  const buyerRef = transaction.collection(MEMBERS_COLLECTION).doc(buyerId);
  const listingRef = transaction.collection(LISTING_COLLECTION).doc(listing._id);

  const [sellerDoc, buyerDoc] = await Promise.all([sellerRef.get(), buyerRef.get()]);
  if (!sellerDoc || !sellerDoc.data) {
    throw createError('SELLER_NOT_FOUND', '卖家信息不存在');
  }
  if (!buyerDoc || !buyerDoc.data) {
    throw createError('BUYER_NOT_FOUND', '买家信息不存在');
  }
  const buyer = buyerDoc.data;
  const seller = sellerDoc.data;

  const buyerBalance = resolveStoneBalance(buyer);
  const sellerName = resolveMemberDisplayName(seller);
  const buyerName = options.buyerName || resolveMemberDisplayName(buyer);

  const saleSource = options.source || 'buyout';

  if (saleSource === 'buyout') {
    if (buyerBalance < price) {
      throw createError('STONE_INSUFFICIENT', '灵石不足，无法购买');
    }
    await buyerRef.update({
      data: {
        stoneBalance: _.inc(-price),
        updatedAt: resolveServerDate()
      }
    });
    await recordStoneTransaction(transaction, {
      memberId: buyerId,
      amount: -price,
      type: 'tradePurchase',
      description: `购入 ${listing.itemSnapshot.itemId} 装备`,
      meta: { listingId: listing._id, saleMode }
    });
  } else if (saleSource === 'auction') {
    await convertBidLockToPurchase(transaction, listing, options.bidId, price);
  }

  await sellerRef.update({
    data: {
      stoneBalance: _.inc(sellerIncome),
      updatedAt: resolveServerDate()
    }
  });

  await recordStoneTransaction(transaction, {
    memberId: sellerId,
    amount: sellerIncome,
    type: 'tradeIncome',
    description: `售出 ${listing.itemSnapshot.itemId} 装备`,
    meta: { listingId: listing._id, saleMode, price, fee }
  });

  await ensureCollection(METRIC_COLLECTION);
  const metricRef = transaction.collection(METRIC_COLLECTION).doc('global');
  const metricSnapshot = await metricRef.get().catch(() => null);
  const metricNow = resolveServerDate();
  if (metricSnapshot && metricSnapshot.data) {
    const updatePayload = {
      totalVolume: _.inc(price),
      totalOrders: _.inc(1),
      updatedAt: metricNow
    };
    if (fee > 0) {
      updatePayload.totalFee = _.inc(fee);
    }
    await metricRef.update({ data: updatePayload });
  } else {
    await metricRef.set({
      data: {
        totalVolume: price,
        totalFee: fee,
        totalOrders: 1,
        updatedAt: metricNow
      }
    });
  }

  await transferItemToBuyer(transaction, buyerId, listing.itemSnapshot);

  await ensureCollection(ORDER_COLLECTION);
  await transaction.collection(ORDER_COLLECTION).add({
    data: {
      listingId: listing._id,
      sellerId,
      sellerName,
      buyerId,
      buyerName,
      itemId: listing.itemSnapshot.itemId,
      price,
      fee,
      netIncome: sellerIncome,
      saleMode,
      source: saleSource,
      createdAt: now,
      updatedAt: now
    }
  });

  await listingRef.update({
    data: {
      status: LISTING_STATUS.SOLD,
      buyerId,
      buyerName,
      soldAt: now,
      updatedAt: now,
      currentPrice: price,
      currentBidderId: saleSource === 'auction' ? buyerId : listing.currentBidderId,
      currentBidderName: saleSource === 'auction' ? buyerName : listing.currentBidderName,
      settlementSource: saleSource,
      settlementFee: fee
    }
  });
}

async function convertBidLockToPurchase(transaction, listing, bidId, price) {
  if (!bidId) {
    return;
  }
  await ensureCollection(BID_COLLECTION);
  const bidRef = transaction.collection(BID_COLLECTION).doc(bidId);
  const bidDoc = await bidRef.get();
  if (!bidDoc || !bidDoc.data) {
    return;
  }
  const bid = bidDoc.data;
  if (bid.status !== BID_STATUS.ACTIVE && bid.status !== BID_STATUS.WON) {
    return;
  }
  await bidRef.update({
    data: {
      status: BID_STATUS.WON,
      updatedAt: resolveServerDate()
    }
  });
  if (bid.lockTransactionId) {
    await transaction.collection(STONE_COLLECTION).doc(bid.lockTransactionId).update({
      data: {
        type: 'tradePurchase',
        description: `竞拍购入 ${listing.itemSnapshot.itemId} 装备`,
        meta: {
          listingId: listing._id,
          bidId,
          price,
          saleMode: listing.saleMode,
          convertedFrom: 'tradeBidLock'
        },
        updatedAt: resolveServerDate()
      }
    });
  }
}

async function transferItemToBuyer(transaction, buyerId, itemSnapshot) {
  const item = sanitizeEquipmentEntry(itemSnapshot);
  if (!item) {
    return;
  }
  const payload = {
    'pveProfile.equipment.inventory': _.push([item]),
    updatedAt: resolveServerDate()
  };
  await transaction.collection(MEMBERS_COLLECTION).doc(buyerId).update({
    data: payload
  });
}

async function recordStoneTransaction(transaction, {
  memberId,
  amount,
  type,
  description,
  meta
}) {
  if (!memberId) {
    return null;
  }
  await ensureCollection(STONE_COLLECTION);
  const res = await transaction.collection(STONE_COLLECTION).add({
    data: {
      memberId,
      amount,
      type,
      description,
      meta: meta || {},
      createdAt: resolveServerDate(),
      updatedAt: resolveServerDate()
    }
  });
  return res && res._id ? res._id : null;
}

async function handleCreateListing(memberId, event = {}) {
  if (!memberId) {
    throw createError('AUTH_REQUIRED', '请先登录后再上架装备');
  }
  const inventoryId = typeof event.inventoryId === 'string' ? event.inventoryId.trim() : '';
  if (!inventoryId) {
    throw createError('INVENTORY_ID_REQUIRED', '请选择要上架的装备');
  }
  const saleMode = normalizeSaleMode(event.saleMode);
  const fixedPrice = toPositiveInt(event.fixedPrice || event.price || 0, 0);
  const startPrice = toPositiveInt(event.startPrice || event.basePrice || 0, 0);
  const buyoutPrice = toPositiveInt(event.buyoutPrice || 0, 0);
  const durationHours = normalizeDurationHours(event.durationHours || event.listingHours || DEFAULT_LISTING_DURATION_HOURS);
  const bidIncrement = resolveBidIncrement(startPrice || fixedPrice || 0, event.bidIncrement);

  if (saleMode === 'fixed' && fixedPrice <= 0) {
    throw createError('PRICE_REQUIRED', '请设置有效的一口价');
  }
  if (saleMode === 'auction' && startPrice <= 0) {
    throw createError('START_PRICE_REQUIRED', '请设置有效的起拍价');
  }

  const maxListings = Math.max(1, TRADING_CONFIG.maxListingsPerMember || 10);
  const activeCountSnapshot = await db
    .collection(LISTING_COLLECTION)
    .where({ sellerId: memberId, status: LISTING_STATUS.ACTIVE })
    .count();
  if (activeCountSnapshot.total >= maxListings) {
    throw createError('LISTING_LIMIT', '已达到同时在售的上限，请先处理现有挂单');
  }

  const expiresAt = new Date(Date.now() + durationHours * 3600 * 1000);
  const now = resolveServerDate();

  await ensureCollection(LISTING_COLLECTION);
  await db.runTransaction(async (transaction) => {
    const memberRef = transaction.collection(MEMBERS_COLLECTION).doc(memberId);
    const memberDoc = await memberRef.get();
    if (!memberDoc || !memberDoc.data) {
      throw createError('MEMBER_NOT_FOUND', '请先完成会员注册');
    }
    const member = memberDoc.data;
    const inventory =
      member && member.pveProfile && member.pveProfile.equipment && Array.isArray(member.pveProfile.equipment.inventory)
        ? member.pveProfile.equipment.inventory
        : [];
    const item = inventory.find((entry) => entry && entry.inventoryId === inventoryId);
    if (!item) {
      throw createError('ITEM_NOT_FOUND', '未找到该装备，可能已被使用或出售');
    }
    const sanitizedItem = sanitizeEquipmentEntry(item);
    if (!sanitizedItem) {
      throw createError('ITEM_INVALID', '该装备数据异常，无法上架');
    }
    if (DEFAULT_EQUIPMENT_ID_SET.has(sanitizedItem.itemId)) {
      throw createError('ITEM_LOCKED', '默认赠送装备不可交易');
    }

    await memberRef.update({
      data: {
        'pveProfile.equipment.inventory': _.pull({ inventoryId }),
        updatedAt: resolveServerDate()
      }
    });

    const listingDoc = {
      sellerId: memberId,
      sellerName: resolveMemberDisplayName(member),
      saleMode,
      status: LISTING_STATUS.ACTIVE,
      fixedPrice: saleMode === 'fixed' ? fixedPrice : null,
      startPrice: saleMode === 'auction' ? startPrice : null,
      currentPrice: saleMode === 'auction' ? startPrice : fixedPrice,
      buyoutPrice: buyoutPrice > 0 ? buyoutPrice : null,
      bidIncrement: saleMode === 'auction' ? bidIncrement : null,
      bidCount: 0,
      itemSnapshot: sanitizedItem,
      bidHistory: [],
      currentBidderId: '',
      currentBidderName: '',
      currentBidId: '',
      createdAt: now,
      updatedAt: now,
      expiresAt,
      settlementSource: '',
      settlementFee: 0
    };

    await transaction.collection(LISTING_COLLECTION).add({ data: listingDoc });
  });

  return { success: true };
}

async function handleCancelListing(memberId, event = {}) {
  const listingId = typeof event.listingId === 'string' ? event.listingId.trim() : '';
  if (!listingId) {
    throw createError('LISTING_REQUIRED', '缺少要取消的挂单');
  }

  await db.runTransaction(async (transaction) => {
    const listingRef = transaction.collection(LISTING_COLLECTION).doc(listingId);
    const listingDoc = await listingRef.get();
    if (!listingDoc || !listingDoc.data) {
      throw createError('LISTING_NOT_FOUND', '挂单不存在或已处理');
    }
    const listing = listingDoc.data;
    if (listing.sellerId !== memberId) {
      throw createError('FORBIDDEN', '仅限卖家取消挂单');
    }
    if (listing.status !== LISTING_STATUS.ACTIVE) {
      throw createError('LISTING_NOT_ACTIVE', '该挂单已结束，无法取消');
    }

    if (listing.currentBidderId && listing.currentBidId) {
      await refundActiveBid(transaction, listing);
    }

    await restoreListingItem(transaction, listing);

    await listingRef.update({
      data: {
        status: LISTING_STATUS.CANCELLED,
        updatedAt: resolveServerDate()
      }
    });
  });

  return { success: true };
}

async function refundActiveBid(transaction, listing) {
  await ensureCollection(BID_COLLECTION);
  const bidId = listing.currentBidId;
  if (!bidId) {
    return;
  }
  const bidRef = transaction.collection(BID_COLLECTION).doc(bidId);
  const bidDoc = await bidRef.get();
  if (!bidDoc || !bidDoc.data) {
    return;
  }
  const bid = bidDoc.data;
  if (!bid.bidderId || !bid.amount) {
    return;
  }
  await transaction.collection(MEMBERS_COLLECTION).doc(bid.bidderId).update({
    data: {
      stoneBalance: _.inc(bid.amount),
      updatedAt: resolveServerDate()
    }
  });
  if (bid.lockTransactionId) {
    await transaction.collection(STONE_COLLECTION).doc(bid.lockTransactionId).update({
      data: {
        type: 'tradeBidRefund',
        description: '竞拍出价被退还',
        updatedAt: resolveServerDate()
      }
    });
  } else {
    await recordStoneTransaction(transaction, {
      memberId: bid.bidderId,
      amount: bid.amount,
      type: 'tradeBidRefund',
      description: '竞拍出价退还',
      meta: { listingId: listing._id }
    });
  }
  await bidRef.update({
    data: {
      status: BID_STATUS.REFUNDED,
      updatedAt: resolveServerDate()
    }
  });
}

async function handleBuyNow(memberId, event = {}) {
  const listingId = typeof event.listingId === 'string' ? event.listingId.trim() : '';
  if (!listingId) {
    throw createError('LISTING_REQUIRED', '请选择要购买的挂单');
  }
  await db.runTransaction(async (transaction) => {
    const listingRef = transaction.collection(LISTING_COLLECTION).doc(listingId);
    const listingDoc = await listingRef.get();
    if (!listingDoc || !listingDoc.data) {
      throw createError('LISTING_NOT_FOUND', '该挂单不存在或已结束');
    }
    const listing = listingDoc.data;
    if (listing.status !== LISTING_STATUS.ACTIVE) {
      throw createError('LISTING_NOT_ACTIVE', '挂单已结束');
    }
    if (listing.sellerId === memberId) {
      throw createError('FORBIDDEN', '不可购买自己的挂单');
    }
    if (listing.saleMode === 'fixed') {
      if (!listing.fixedPrice || listing.fixedPrice <= 0) {
        throw createError('PRICE_INVALID', '该挂单未设置有效价格');
      }
      await completeSale(transaction, listing, {
        buyerId: memberId,
        buyerName: event.buyerName || '',
        price: listing.fixedPrice,
        source: 'buyout'
      });
    } else if (listing.saleMode === 'auction') {
      const price = listing.buyoutPrice && listing.buyoutPrice > 0 ? listing.buyoutPrice : listing.currentPrice;
      if (!price || price <= 0) {
        throw createError('PRICE_INVALID', '该拍卖未设置有效一口价');
      }
      if (!listing.buyoutPrice || listing.buyoutPrice <= 0) {
        throw createError('BUYOUT_DISABLED', '该拍卖不支持一口价购买');
      }
      if (listing.currentBidderId && listing.currentBidderId !== memberId) {
        await refundActiveBid(transaction, listing);
      }
      await completeSale(transaction, listing, {
        buyerId: memberId,
        buyerName: event.buyerName || '',
        price: listing.buyoutPrice,
        source: 'buyout'
      });
    } else {
      throw createError('MODE_UNSUPPORTED', '未知的售卖模式');
    }
  });

  return { success: true };
}

async function handlePlaceBid(memberId, event = {}) {
  if (!memberId) {
    throw createError('AUTH_REQUIRED', '请先登录后再出价');
  }
  const listingId = typeof event.listingId === 'string' ? event.listingId.trim() : '';
  if (!listingId) {
    throw createError('LISTING_REQUIRED', '请选择要竞拍的挂单');
  }
  const amount = toPositiveInt(event.amount, 0);
  if (amount <= 0) {
    throw createError('BID_INVALID', '请输入有效的出价');
  }
  const maxBids = Math.max(1, TRADING_CONFIG.maxActiveBidsPerMember || 50);
  const activeBidCount = await db
    .collection(BID_COLLECTION)
    .where({ bidderId: memberId, status: BID_STATUS.ACTIVE })
    .count();
  if (activeBidCount.total >= maxBids) {
    throw createError('BID_LIMIT', '您当前有过多的活跃出价，请先等待结果或取消其他竞拍');
  }
  await ensureCollection(BID_COLLECTION);

  await db.runTransaction(async (transaction) => {
    const listingRef = transaction.collection(LISTING_COLLECTION).doc(listingId);
    const listingDoc = await listingRef.get();
    if (!listingDoc || !listingDoc.data) {
      throw createError('LISTING_NOT_FOUND', '挂单不存在');
    }
    const listing = listingDoc.data;
    if (listing.status !== LISTING_STATUS.ACTIVE) {
      throw createError('LISTING_NOT_ACTIVE', '挂单已结束');
    }
    if (listing.saleMode !== 'auction') {
      throw createError('NOT_AUCTION', '该挂单为一口价，无法竞拍');
    }
    if (listing.sellerId === memberId) {
      throw createError('FORBIDDEN', '不可竞拍自己的挂单');
    }
    const hasExistingBid = !!(listing.currentBidderId && listing.currentPrice);
    const basePrice = hasExistingBid
      ? Math.max(listing.currentPrice || 0, listing.startPrice || 0)
      : Math.max(listing.startPrice || 0, 1);
    const minIncrement = listing.bidIncrement || resolveBidIncrement(basePrice, listing.bidIncrement);
    const minAcceptable = hasExistingBid ? basePrice + minIncrement : basePrice;
    if (amount < minAcceptable) {
      throw createError('BID_TOO_LOW', `当前最低出价为 ${minAcceptable}`);
    }

    const memberRef = transaction.collection(MEMBERS_COLLECTION).doc(memberId);
    const memberDoc = await memberRef.get();
    if (!memberDoc || !memberDoc.data) {
      throw createError('MEMBER_NOT_FOUND', '请先完成会员注册');
    }
    const member = memberDoc.data;
    const balance = resolveStoneBalance(member);
    if (balance < amount) {
      throw createError('STONE_INSUFFICIENT', '灵石不足，无法出价');
    }

    await memberRef.update({
      data: {
        stoneBalance: _.inc(-amount),
        updatedAt: resolveServerDate()
      }
    });

    const bidLockTransactionId = await recordStoneTransaction(transaction, {
      memberId,
      amount: -amount,
      type: 'tradeBidLock',
      description: '竞拍出价锁定',
      meta: { listingId }
    });

    if (listing.currentBidderId && listing.currentBidId) {
      await refundActiveBid(transaction, listing);
    }

    const bidEntry = {
      listingId,
      bidderId: memberId,
      bidderName: resolveMemberDisplayName(member),
      amount,
      status: BID_STATUS.ACTIVE,
      createdAt: resolveServerDate(),
      updatedAt: resolveServerDate(),
      lockTransactionId: bidLockTransactionId
    };
    const bidResult = await transaction.collection(BID_COLLECTION).add({ data: bidEntry });
    const bidId = bidResult && bidResult._id ? bidResult._id : '';

    const bidHistoryEntry = {
      bidderId: memberId,
      bidderName: resolveMemberDisplayName(member),
      amount,
      createdAt: resolveServerDate()
    };
    const bidHistory = Array.isArray(listing.bidHistory) ? listing.bidHistory.slice(0, MAX_BID_HISTORY - 1) : [];
    bidHistory.unshift(bidHistoryEntry);
    if (bidHistory.length > MAX_BID_HISTORY) {
      bidHistory.length = MAX_BID_HISTORY;
    }

    await listingRef.update({
      data: {
        currentPrice: amount,
        currentBidderId: memberId,
        currentBidderName: resolveMemberDisplayName(member),
        currentBidId: bidId,
        bidCount: _.inc(1),
        bidHistory,
        updatedAt: resolveServerDate()
      }
    });
  });

  return { success: true };
}

async function handleSellable(memberId) {
  if (!memberId) {
    throw createError('AUTH_REQUIRED', '请先登录后再查看可售装备');
  }
  const memberSnapshot = await db.collection(MEMBERS_COLLECTION).doc(memberId).get();
  if (!memberSnapshot || !memberSnapshot.data) {
    throw createError('MEMBER_NOT_FOUND', '未找到会员信息');
  }
  const member = memberSnapshot.data;
  const inventory =
    member && member.pveProfile && member.pveProfile.equipment && Array.isArray(member.pveProfile.equipment.inventory)
      ? member.pveProfile.equipment.inventory
      : [];
  const sellable = [];
  inventory.some((entry) => {
    if (sellable.length >= MAX_SELLABLE_ITEMS) {
      return true;
    }
    const sanitized = sanitizeEquipmentEntry(entry);
    if (!sanitized || !sanitized.inventoryId || DEFAULT_EQUIPMENT_ID_SET.has(sanitized.itemId)) {
      return false;
    }
    sellable.push(buildEquipmentSummary(sanitized));
    return false;
  });
  return {
    items: sellable,
    limit: MAX_SELLABLE_ITEMS
  };
}

async function handleDashboard(memberId) {
  const now = new Date();
  await settleExpiredListings(now);
  await ensureCollection(LISTING_COLLECTION);
  await ensureCollection(BID_COLLECTION);
  const [memberSnapshot, listingsSnapshot, ownSnapshot, bidSnapshot] = await Promise.all([
    memberId ? db.collection(MEMBERS_COLLECTION).doc(memberId).get().catch(() => null) : Promise.resolve(null),
    db
      .collection(LISTING_COLLECTION)
      .where({ status: LISTING_STATUS.ACTIVE })
      .orderBy('createdAt', 'desc')
      .limit(MAX_LISTING_FETCH)
      .get(),
    memberId
      ? db
          .collection(LISTING_COLLECTION)
          .where({ sellerId: memberId })
          .orderBy('createdAt', 'desc')
          .limit(MAX_LISTING_FETCH)
          .get()
      : Promise.resolve({ data: [] }),
    memberId
      ? db
          .collection(BID_COLLECTION)
          .where({ bidderId: memberId })
          .orderBy('createdAt', 'desc')
          .limit(30)
          .get()
      : Promise.resolve({ data: [] }),
  ]);

  const member = memberSnapshot && memberSnapshot.data ? memberSnapshot.data : null;
  const balance = resolveStoneBalance(member);
  const listings = (listingsSnapshot.data || [])
    .map((doc) => buildListingResponse(doc, memberId))
    .filter(Boolean);
  const myListings = (ownSnapshot.data || [])
    .map((doc) => buildListingResponse(doc, memberId))
    .filter(Boolean);
  const myBids = (bidSnapshot.data || [])
    .map((doc) => buildBidResponse(doc, memberId))
    .filter(Boolean);

  return {
    balance,
    listings,
    myListings,
    myBids,
    config: {
      feeRate: TRADING_CONFIG.feeRate || 0,
      minDurationHours: TRADING_CONFIG.minDurationHours || 24,
      maxDurationHours: TRADING_CONFIG.maxDurationHours || 168,
      maxListingsPerMember: TRADING_CONFIG.maxListingsPerMember || 10,
      minBidIncrementRate: TRADING_CONFIG.minBidIncrementRate || 0.05
    }
  };
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'dashboard';
  const { memberId: actingMemberId, proxySession } = await proxyHelpers.resolveProxyContext(OPENID);
  const targetMemberId = actingMemberId || OPENID;

  if (proxySession) {
    await proxyHelpers.recordProxyAction(proxySession, OPENID, action, event || {});
  }

  switch (action) {
    case 'dashboard':
      return handleDashboard(targetMemberId);
    case 'sellable':
      return handleSellable(targetMemberId);
    case 'createListing':
      return handleCreateListing(targetMemberId, event);
    case 'cancelListing':
      return handleCancelListing(targetMemberId, event);
    case 'buyNow':
      return handleBuyNow(targetMemberId, event);
    case 'placeBid':
      return handlePlaceBid(targetMemberId, event);
    default:
      throw createError('UNKNOWN_ACTION', `未知交易操作：${action}`);
  }
};
