const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { COLLECTIONS, DEFAULT_ADMIN_ROLES } = require('common-config');
const { createProxyHelpers } = require('admin-proxy');

const db = cloud.database();
const _ = db.command;
const ADMIN_ROLES = DEFAULT_ADMIN_ROLES;
const proxyHelpers = createProxyHelpers(cloud, { loggerTag: 'reservation' });

const MINUTES_PER_DAY = 24 * 60;
const DAY_IN_MS = MINUTES_PER_DAY * 60 * 1000;

const RESERVATION_ACTIVE_STATUSES = [
  'pendingApproval',
  'approved',
  'reserved',
  'confirmed',
  'pendingPayment'
];

const MEMBER_VISIBLE_STATUSES = [
  'pendingApproval',
  'approved',
  'reserved',
  'confirmed',
  'pendingPayment'
];

const MEMBER_FETCH_STATUSES = [...new Set([...MEMBER_VISIBLE_STATUSES, 'rejected', 'cancelled'])];

const MEMBER_RESERVATION_LIMIT = 10;

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'availableRooms';

  const { memberId: actingMemberId, proxySession } = await proxyHelpers.resolveProxyContext(OPENID);
  const targetMemberId = actingMemberId || OPENID;

  if (proxySession) {
    await proxyHelpers.recordProxyAction(proxySession, OPENID, action, event || {});
  }

  switch (action) {
    case 'availableRooms':
      return listAvailableRooms(
        targetMemberId,
        event.date,
        event.startTime,
        event.endTime,
        event.endDate
      );
    case 'create':
      return createReservation(targetMemberId, event.order || {});
    case 'cancel':
      return cancelReservation(targetMemberId, event.reservationId);
    case 'redeemUsageCoupon':
      return redeemRoomUsageCoupon(targetMemberId, event.memberRightId);
    default:
      throw new Error(`Unknown action: ${action}`);
  }
};

async function listAvailableRooms(memberId, date, startTime, endTime, endDate) {
  if (!date || !startTime || !endTime) {
    throw new Error('请提供预约日期与时间');
  }
  if (!parseDateString(date)) {
    throw new Error('预约日期不正确');
  }
  const requestRange = normalizeTimeRange(startTime, endTime, { allowCrossDay: true });
  if (!requestRange) {
    throw new Error('预约时间不正确');
  }

  const normalizedEndDate = resolveReservationEndDate(date, endDate, requestRange);
  const endDayDiff = diffInDays(normalizedEndDate, date);
  const endMinutesOfDay = timeToMinutes(endTime);
  const requestEndCandidate = Number.isFinite(endMinutesOfDay)
    ? endMinutesOfDay + Math.max(0, endDayDiff) * MINUTES_PER_DAY
    : requestRange.end;
  const requestTimelineRange = {
    start: requestRange.start,
    end: Math.max(requestRange.end, requestEndCandidate)
  };
  if (requestTimelineRange.end <= requestTimelineRange.start) {
    throw new Error('预约时间不正确');
  }

  const dateRange = enumerateDateRange(date, normalizedEndDate);
  if (!dateRange.length) {
    throw new Error('预约日期不正确');
  }

  const [
    roomsSnapshot,
    reservationsSnapshot,
    rightsSnapshot,
    rightsMasterSnapshot,
    memberReservationSnapshot,
    memberDoc
  ] = await Promise.all([
    db
      .collection(COLLECTIONS.ROOMS)
      .where({ status: 'online' })
      .orderBy('priority', 'asc')
      .get(),
    db
      .collection(COLLECTIONS.RESERVATIONS)
      .where({
        date: _.in(dateRange),
        status: _.in(RESERVATION_ACTIVE_STATUSES)
      })
      .get(),
    db
      .collection(COLLECTIONS.MEMBER_RIGHTS)
      .where({ memberId, status: 'active' })
      .get(),
    db.collection(COLLECTIONS.MEMBERSHIP_RIGHTS).get(),
    db
      .collection(COLLECTIONS.RESERVATIONS)
      .where({
        memberId,
        status: _.in(MEMBER_FETCH_STATUSES)
      })
      .orderBy('date', 'desc')
      .orderBy('startTime', 'desc')
      .limit(MEMBER_RESERVATION_LIMIT)
      .get(),
    db
      .collection(COLLECTIONS.MEMBERS)
      .doc(memberId)
      .get()
      .catch(() => null)
  ]);

  const reservedRoomIds = new Set(
    reservationsSnapshot.data
      .map((reservation) => ({
        reservation,
        range: normalizeReservationRange(reservation, { allowCrossDay: true, relativeTo: date })
      }))
      .filter(({ range }) => range && isTimeRangeOverlap(range, requestTimelineRange))
      .map(({ reservation }) => reservation.roomId)
  );

  const now = Date.now();
  const masterMap = {};
  rightsMasterSnapshot.data.forEach((item) => {
    masterMap[item._id] = item;
  });
  const validRights = rightsSnapshot.data.filter((right) => {
    if (!right.validUntil) return true;
    return new Date(right.validUntil).getTime() >= now;
  });

  const roomMap = new Map();
  roomsSnapshot.data.forEach((room) => {
    roomMap.set(room._id, room);
  });

  const rooms = roomsSnapshot.data
    .map((room) => {
      const right = validRights.find((r) => canRightApply(masterMap[r.rightId], requestRange));
      return {
        _id: room._id,
        name: room.name,
        capacity: room.capacity,
        facilities: (room.facilities || []).join('、'),
        price: resolvePrice(room, requestRange),
        isFree: Boolean(right),
        images: room.images || []
      };
    })
    .filter((room) => !reservedRoomIds.has(room._id));

  const memberRecord = (memberDoc && memberDoc.data) || null;
  const usageCount = normalizeUsageCount(memberRecord && memberRecord.roomUsageCount);
  const badges = normalizeReservationBadges(memberRecord && memberRecord.reservationBadges);

  if (badges.memberSeenVersion < badges.memberVersion) {
    await db
      .collection(COLLECTIONS.MEMBERS)
      .doc(memberId)
      .update({
        data: {
          'reservationBadges.memberSeenVersion': badges.memberVersion,
          updatedAt: new Date()
        }
      })
      .catch(() => {});
    badges.memberSeenVersion = badges.memberVersion;
  }

  const notice = buildMemberReservationNotice(
    memberReservationSnapshot.data,
    roomsSnapshot.data,
    usageCount
  );

  const memberReservations = buildMemberReservationList(
    memberReservationSnapshot.data,
    roomMap
  );

  return {
    rooms,
    notice,
    memberUsageCount: usageCount,
    memberReservations,
    reservationBadges: badges
  };
}

async function createReservation(memberId, order) {
  const { roomId, date, startTime, endTime, endDate, rightId } = order;
  if (!roomId || !date || !startTime || !endTime) {
    throw new Error('预约信息不完整');
  }
  if (!parseDateString(date)) {
    throw new Error('预约日期不正确');
  }
  const requestRange = normalizeTimeRange(startTime, endTime, { allowCrossDay: true });
  if (!requestRange) {
    throw new Error('预约时间不正确');
  }
  const normalizedEndDate = resolveReservationEndDate(date, endDate, requestRange);
  const endDayDiff = diffInDays(normalizedEndDate, date);
  const endMinutesOfDay = timeToMinutes(endTime);
  const requestEndCandidate = Number.isFinite(endMinutesOfDay)
    ? endMinutesOfDay + Math.max(0, endDayDiff) * MINUTES_PER_DAY
    : requestRange.end;
  const requestTimelineRange = {
    start: requestRange.start,
    end: Math.max(requestRange.end, requestEndCandidate)
  };
  if (requestTimelineRange.end <= requestTimelineRange.start) {
    throw new Error('预约时间不正确');
  }
  const dateRange = enumerateDateRange(date, normalizedEndDate);
  if (!dateRange.length) {
    throw new Error('预约日期不正确');
  }
  const roomDoc = await db.collection(COLLECTIONS.ROOMS).doc(roomId).get().catch(() => null);
  if (!roomDoc || !roomDoc.data) {
    throw new Error('包房不存在');
  }

  const reservationResult = await db.runTransaction(async (transaction) => {
    const memberSnapshot = await transaction
      .collection(COLLECTIONS.MEMBERS)
      .doc(memberId)
      .get()
      .catch(() => null);
    if (!memberSnapshot || !memberSnapshot.data) {
      throw new Error('会员信息不存在');
    }
    const usageCount = normalizeUsageCount(memberSnapshot.data.roomUsageCount);
    if (usageCount <= 0) {
      throw new Error('剩余包房使用次数不足，请联系管理员或使用包房券');
    }

    const existingReservations = await transaction
      .collection(COLLECTIONS.RESERVATIONS)
      .where({
        roomId,
        date: _.in(dateRange),
        status: _.in(RESERVATION_ACTIVE_STATUSES)
      })
      .get();

    const hasConflict = existingReservations.data.some((reservation) => {
      const range = normalizeReservationRange(reservation, { allowCrossDay: true, relativeTo: date });
      if (!range) return false;
      return isTimeRangeOverlap(range, requestTimelineRange);
    });
    if (hasConflict) {
      throw new Error('当前时段已被预约');
    }

    let appliedRight = null;
    let price = resolvePrice(roomDoc.data, requestRange);
    if (rightId) {
      const rightDoc = await transaction
        .collection(COLLECTIONS.MEMBER_RIGHTS)
        .doc(rightId)
        .get()
        .catch(() => null);
      const right = rightDoc && rightDoc.data;
      if (!right || right.memberId !== memberId || right.status !== 'active') {
        throw new Error('权益不可用');
      }
      if (right.validUntil && new Date(right.validUntil).getTime() < Date.now()) {
        throw new Error('权益已过期');
      }
      const masterDoc = await transaction
        .collection(COLLECTIONS.MEMBERSHIP_RIGHTS)
        .doc(right.rightId)
        .get()
        .catch(() => null);
      if (!masterDoc || !masterDoc.data || !canRightApply(masterDoc.data, requestRange)) {
        throw new Error('权益不适用于当前时段');
      }
      appliedRight = rightDoc;
      price = 0;
    }

    const reservation = {
      memberId,
      roomId,
      date,
      endDate: normalizedEndDate,
      startTime: requestRange.startLabel,
      endTime: requestRange.endLabel,
      price,
      rightId: appliedRight ? appliedRight.data._id : null,
      status: 'pendingApproval',
      approval: {
        status: 'pending'
      },
      usageCredits: 1,
      usageRefunded: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const res = await transaction.collection(COLLECTIONS.RESERVATIONS).add({ data: reservation });

    await transaction.collection(COLLECTIONS.MEMBERS).doc(memberId).update({
      data: {
        roomUsageCount: Math.max(0, usageCount - 1),
        updatedAt: new Date(),
        'reservationBadges.memberVersion': _.inc(1)
      }
    });

    if (appliedRight) {
      await transaction.collection(COLLECTIONS.MEMBER_RIGHTS).doc(appliedRight.data._id).update({
        data: {
          status: 'locked',
          reservationId: res._id,
          updatedAt: new Date()
        }
      });
    }

    return { id: res._id, reservation };
  });

  await updateAdminReservationBadges({ incrementVersion: true });

  return {
    success: true,
    message: '预约申请已提交，请等待管理员审核',
    reservationId: reservationResult.id,
    reservation: reservationResult.reservation
  };
}

async function cancelReservation(memberId, reservationId) {
  if (!reservationId) {
    throw new Error('预约不存在');
  }

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction
      .collection(COLLECTIONS.RESERVATIONS)
      .doc(reservationId)
      .get()
      .catch(() => null);
    if (!snapshot || !snapshot.data) {
      throw new Error('预约不存在');
    }
    const reservation = { ...snapshot.data, _id: reservationId };
    if (reservation.memberId !== memberId) {
      throw new Error('无权操作该预约');
    }
    if (reservation.status === 'cancelled') {
      return;
    }

    await transaction.collection(COLLECTIONS.RESERVATIONS).doc(reservationId).update({
      data: {
        status: 'cancelled',
        updatedAt: new Date()
      }
    });

    await releaseReservationResources(transaction, reservation, { refundUsage: true, unlockRight: true });

  });

  await updateAdminReservationBadges({ incrementVersion: false });

  return { success: true, message: '预约已取消' };
}

async function redeemRoomUsageCoupon(memberId, memberRightId) {
  if (!memberRightId) {
    throw new Error('缺少权益编号');
  }

  const usageCount = await db.runTransaction(async (transaction) => {
    const rightSnapshot = await transaction
      .collection(COLLECTIONS.MEMBER_RIGHTS)
      .doc(memberRightId)
      .get()
      .catch(() => null);
    if (!rightSnapshot || !rightSnapshot.data) {
      throw new Error('权益不存在');
    }
    const right = rightSnapshot.data;
    if (right.memberId !== memberId) {
      throw new Error('无权操作该权益');
    }
    if (right.status !== 'active') {
      throw new Error('权益状态不可用');
    }
    if (right.validUntil && new Date(right.validUntil).getTime() < Date.now()) {
      throw new Error('权益已过期');
    }

    const masterSnapshot = await transaction
      .collection(COLLECTIONS.MEMBERSHIP_RIGHTS)
      .doc(right.rightId)
      .get()
      .catch(() => null);
    const master = masterSnapshot && masterSnapshot.data;
    const increment = resolveCouponUsageCount(master, right);
    if (increment <= 0) {
      throw new Error('该权益不支持兑换包房使用次数');
    }

    await transaction.collection(COLLECTIONS.MEMBER_RIGHTS).doc(memberRightId).update({
      data: {
        status: 'used',
        usedAt: new Date(),
        updatedAt: new Date(),
        meta: {
          ...(right.meta || {}),
          redeemedFor: 'roomUsage',
          redeemedUsageCount: increment
        }
      }
    });

    await transaction.collection(COLLECTIONS.MEMBERS).doc(memberId).update({
      data: {
        roomUsageCount: _.inc(increment),
        updatedAt: new Date()
      }
    });

    return increment;
  });

  return {
    success: true,
    usageCount,
    message: '已成功增加包房使用次数'
  };
}

function buildMemberReservationList(reservations, roomMap) {
  if (!Array.isArray(reservations) || !reservations.length) {
    return [];
  }
  const result = reservations
    .filter((reservation) => reservation && MEMBER_VISIBLE_STATUSES.includes(reservation.status))
    .map((reservation) => {
      const room = reservation.roomId ? roomMap.get(reservation.roomId) : null;
      const roomName = resolveRoomName(room, reservation.roomName);
      return {
        _id: reservation._id,
        roomId: reservation.roomId || '',
        roomName,
        date: reservation.date || '',
        endDate: reservation.endDate || reservation.date || '',
        startTime: reservation.startTime || '',
        endTime: reservation.endTime || '',
        status: reservation.status || 'pendingApproval',
        statusLabel: resolveReservationStatusLabel(reservation.status),
        price: Number(reservation.price || 0),
        canCancel: canMemberCancelReservation(reservation.status),
        updatedAt: reservation.updatedAt || reservation.createdAt || null
      };
    });

  result.sort((a, b) => {
    const dateDiff = compareDateTime(a, b);
    if (dateDiff !== 0) {
      return dateDiff;
    }
    if (a.updatedAt && b.updatedAt) {
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    }
    return 0;
  });

  return result;
}

function compareDateTime(a, b) {
  const dateA = new Date(`${a.date || ''}T${a.startTime || '00:00'}:00`).getTime();
  const dateB = new Date(`${b.date || ''}T${b.startTime || '00:00'}:00`).getTime();
  if (Number.isFinite(dateA) && Number.isFinite(dateB)) {
    return dateA - dateB;
  }
  if (Number.isFinite(dateA)) {
    return -1;
  }
  if (Number.isFinite(dateB)) {
    return 1;
  }
  return 0;
}

function canMemberCancelReservation(status) {
  return ['pendingApproval', 'approved', 'reserved', 'confirmed', 'pendingPayment'].includes(status);
}

function resolveRoomName(room, fallback) {
  if (room && typeof room === 'object') {
    if (typeof room.name === 'string' && room.name) {
      return room.name;
    }
    if (typeof room.title === 'string' && room.title) {
      return room.title;
    }
  }
  if (typeof fallback === 'string' && fallback) {
    return fallback;
  }
  return '包房';
}

function resolveReservationStatusLabel(status) {
  const map = {
    pendingApproval: '待审核',
    approved: '已通过',
    rejected: '已拒绝',
    cancelled: '已取消',
    reserved: '已预约',
    confirmed: '已确认',
    pendingPayment: '待支付'
  };
  return map[status] || '待处理';
}

function normalizeReservationBadges(badges) {
  const defaults = {
    memberVersion: 0,
    memberSeenVersion: 0,
    adminVersion: 0,
    adminSeenVersion: 0,
    pendingApprovalCount: 0
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

async function updateAdminReservationBadges({ incrementVersion = false } = {}) {
  try {
    const [pendingResult, adminSnapshot] = await Promise.all([
      db
        .collection(COLLECTIONS.RESERVATIONS)
        .where({ status: 'pendingApproval' })
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
              'reservationBadges.pendingApprovalCount': pendingCount,
              ...(incrementVersion ? { 'reservationBadges.adminVersion': _.inc(1) } : {}),
              updatedAt: new Date()
            }
          })
          .catch(() => {})
      )
    );

    return pendingCount;
  } catch (error) {
    console.error('[reservation] update admin badges failed', error);
    return 0;
  }
}

function resolvePrice(room, range) {
  if (!room || !room.pricing) return 0;
  const pricing = room.pricing;
  if (typeof pricing.fixed === 'number') {
    return pricing.fixed;
  }
  if (typeof pricing.hourly === 'number') {
    const hours = Math.max(1, Math.ceil((range.end - range.start) / 60));
    return pricing.hourly * hours;
  }
  return 0;
}

function canRightApply(right, range) {
  if (!right) return false;
  if (!right.applyReservation) return false;
  const ranges = normalizeRightTimeRanges(right);
  if (!ranges.length) return true;
  return ranges.some((candidate) => candidate.start <= range.start && candidate.end >= range.end);
}

function normalizeTimeRange(startTime, endTime, { allowCrossDay = false } = {}) {
  const start = timeToMinutes(startTime);
  const endRaw = timeToMinutes(endTime);
  if (!Number.isFinite(start) || !Number.isFinite(endRaw)) {
    return null;
  }
  if (start === endRaw) {
    return null;
  }
  let end = endRaw;
  let daySpan = 0;
  if (allowCrossDay) {
    while (end <= start) {
      end += MINUTES_PER_DAY;
      daySpan += 1;
      if (daySpan > 7) {
        return null;
      }
    }
  }
  if (end <= start) {
    return null;
  }
  return {
    start,
    end,
    startLabel: formatTimeLabel(start),
    endLabel: formatTimeLabel(endRaw),
    daySpan,
    duration: end - start
  };
}

function normalizeRightTimeRanges(right) {
  if (!right) return [];
  if (Array.isArray(right.applyTimeRanges) && right.applyTimeRanges.length) {
    return right.applyTimeRanges
      .map((item) => normalizeTimeRange(item.startTime || item.start || '', item.endTime || item.end || ''))
      .filter(Boolean);
  }
  if (Array.isArray(right.applySlots) && right.applySlots.length) {
    const slotRanges = {
      day: normalizeTimeRange('12:00', '18:00'),
      night: normalizeTimeRange('18:00', '24:00'),
      late: normalizeTimeRange('00:00', '06:00')
    };
    return right.applySlots
      .map((slot) => slotRanges[slot])
      .filter(Boolean);
  }
  return [];
}

function normalizeReservationRange(reservation, options = {}) {
  if (!reservation) return null;
  const { allowCrossDay = false, relativeTo } = options;
  let range = normalizeTimeRange(reservation.startTime, reservation.endTime, { allowCrossDay });
  if (!range && reservation.slot) {
    const slotRanges = {
      day: normalizeTimeRange('12:00', '18:00'),
      night: normalizeTimeRange('18:00', '24:00'),
      late: normalizeTimeRange('00:00', '06:00')
    };
    range = slotRanges[reservation.slot] || null;
  }
  if (!range) {
    return null;
  }
  if (!relativeTo) {
    return range;
  }

  const baseDateStr = relativeTo;
  const startDateStr = reservation.date || baseDateStr;
  const startDayDiff = diffInDays(startDateStr, baseDateStr);
  if (!Number.isFinite(startDayDiff)) {
    return range;
  }
  const endDateStr = reservation.endDate || startDateStr;
  let endDayDiff = diffInDays(endDateStr, baseDateStr);
  if (!Number.isFinite(endDayDiff)) {
    endDayDiff = startDayDiff + (range.daySpan || 0);
  }
  if (endDayDiff < startDayDiff) {
    endDayDiff = startDayDiff + (range.daySpan || 0);
  }

  const startMinutes = range.start + startDayDiff * MINUTES_PER_DAY;
  const endTimeMinutes = timeToMinutes(reservation.endTime);
  let endMinutes;
  if (Number.isFinite(endTimeMinutes)) {
    endMinutes = endTimeMinutes + endDayDiff * MINUTES_PER_DAY;
    if (endMinutes <= startMinutes) {
      endMinutes = startMinutes + range.duration;
    }
  } else {
    endMinutes = startMinutes + range.duration + Math.max(0, endDayDiff - startDayDiff) * MINUTES_PER_DAY;
  }

  return {
    start: startMinutes,
    end: endMinutes,
    startLabel: range.startLabel,
    endLabel: range.endLabel,
    daySpan: Math.max(0, endDayDiff - startDayDiff)
  };
}

function isTimeRangeOverlap(a, b) {
  if (!a || !b) return false;
  return a.start < b.end && b.start < a.end;
}

function timeToMinutes(value) {
  if (typeof value !== 'string') return NaN;
  const [hourStr, minuteStr] = value.split(':');
  if (typeof hourStr === 'undefined' || typeof minuteStr === 'undefined') {
    return NaN;
  }
  const hours = Number(hourStr);
  const minutes = Number(minuteStr);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return NaN;
  }
  if (hours < 0 || hours > 24) {
    return NaN;
  }
  if (minutes < 0 || minutes > 59) {
    return NaN;
  }
  if (hours === 24 && minutes !== 0) {
    return NaN;
  }
  return hours * 60 + minutes;
}

function formatTimeLabel(totalMinutes) {
  const minutes = Math.max(0, Math.min(24 * 60, totalMinutes));
  const hoursPart = Math.floor(minutes / 60);
  const minutesPart = minutes % 60;
  return `${String(hoursPart).padStart(2, '0')}:${String(minutesPart).padStart(2, '0')}`;
}

function parseDateString(value) {
  if (typeof value !== 'string') return null;
  const [yearStr, monthStr, dayStr] = value.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function formatDateString(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shiftDateString(dateStr, offsetDays) {
  const base = parseDateString(dateStr);
  if (!base || !Number.isInteger(offsetDays)) {
    return '';
  }
  const shifted = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offsetDays);
  return formatDateString(shifted);
}

function enumerateDateRange(startDateStr, endDateStr) {
  const start = parseDateString(startDateStr);
  const end = parseDateString(endDateStr || startDateStr);
  if (!start || !end) {
    return [];
  }
  if (end.getTime() < start.getTime()) {
    return [];
  }
  const result = [];
  for (let cursor = new Date(start.getTime()); cursor.getTime() <= end.getTime(); cursor = new Date(cursor.getTime() + DAY_IN_MS)) {
    result.push(formatDateString(cursor));
  }
  return result;
}

function diffInDays(targetDateStr, baseDateStr) {
  const target = parseDateString(targetDateStr);
  const base = parseDateString(baseDateStr);
  if (!target || !base) {
    return NaN;
  }
  const utcTarget = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  const utcBase = Date.UTC(base.getFullYear(), base.getMonth(), base.getDate());
  return Math.round((utcTarget - utcBase) / DAY_IN_MS);
}

function resolveReservationEndDate(startDateStr, providedEndDateStr, range) {
  const minimumSpan = range && Number.isInteger(range.daySpan) ? Math.max(0, range.daySpan) : 0;
  const minimumEndDate = shiftDateString(startDateStr, minimumSpan) || startDateStr;
  const provided = parseDateString(providedEndDateStr);
  const startDate = parseDateString(startDateStr);
  if (!startDate) {
    return minimumEndDate;
  }
  if (provided) {
    if (provided.getTime() < startDate.getTime()) {
      return minimumEndDate;
    }
    const minDate = parseDateString(minimumEndDate);
    if (minDate && provided.getTime() < minDate.getTime()) {
      return minimumEndDate;
    }
    return formatDateString(provided);
  }
  return minimumEndDate;
}

function normalizeUsageCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.floor(numeric));
}

function buildMemberReservationNotice(memberReservations, rooms, usageCount) {
  if (!Array.isArray(memberReservations) || !memberReservations.length) {
    return null;
  }
  const latest = memberReservations[0];
  const roomMap = new Map();
  (rooms || []).forEach((room) => {
    roomMap.set(room._id, room);
  });
  const room = roomMap.get(latest.roomId);
  const roomName = room ? room.name : '包房';
  const normalizedRange = normalizeReservationRange(latest, { allowCrossDay: true });
  const timeRangeLabel = normalizedRange ? `${normalizedRange.startLabel} - ${normalizedRange.endLabel}` : '';
  const scheduleLabel = [latest.date, timeRangeLabel || latest.slotLabel || latest.slot]
    .filter(Boolean)
    .join(' ');
  const approval = latest.approval || {};
  const decisionReason = typeof approval.reason === 'string' ? approval.reason.trim() : '';
  const details = [];
  if (roomName) {
    details.push(`包房：${roomName}`);
  }
  if (scheduleLabel) {
    details.push(`时间：${scheduleLabel}`);
  }
  if (decisionReason) {
    details.push(`原因：${decisionReason}`);
  }
  const detailText = details.join('，');
  if (latest.status === 'approved') {
    return {
      type: 'success',
      message: `已预约成功：${roomName}${scheduleLabel ? `，请于 ${scheduleLabel} 入场。` : '。'}`,
      closable: false,
      reservationId: latest._id
    };
  }
  if (latest.status === 'pendingApproval') {
    return {
      type: 'info',
      message: `${roomName} 的预约申请正在审核中，请耐心等待管理员处理。`,
      closable: false,
      reservationId: latest._id
    };
  }
  if (latest.status === 'rejected') {
    const messageParts = ['预约未通过，请重新选择时间。'];
    if (detailText) {
      messageParts.push(detailText);
    }
    return {
      type: 'warning',
      message: messageParts.join('').trim(),
      closable: true,
      reservationId: latest._id,
      code: 'reservationRejected'
    };
  }
  if (latest.status === 'cancelled') {
    const decidedBy = approval.decidedBy || '';
    const decisionStatus = approval.status || '';
    const memberId = latest.memberId || '';
    const isAdminCancellation = decisionStatus === 'cancelled' && decidedBy && memberId && decidedBy !== memberId;
    if (!isAdminCancellation) {
      return null;
    }
    const messageParts = ['预约已被管理员取消。'];
    if (detailText) {
      messageParts.push(detailText);
    }
    return {
      type: 'warning',
      message: messageParts.join('').trim(),
      closable: true,
      reservationId: latest._id,
      code: 'reservationCancelled'
    };
  }
  return null;
}

async function releaseReservationResources(transaction, reservation, options = {}) {
  const { refundUsage = false, unlockRight = true } = options;
  if (!reservation || !reservation._id) {
    return;
  }
  const updates = {};
  if (refundUsage && !reservation.usageRefunded) {
    const credits = normalizeUsageCount(reservation.usageCredits || 1);
    if (credits > 0) {
      await transaction
        .collection(COLLECTIONS.MEMBERS)
        .doc(reservation.memberId)
        .update({
          data: {
            roomUsageCount: _.inc(credits),
            updatedAt: new Date()
          }
        })
        .catch(() => {});
      updates.usageRefunded = true;
    }
  }

  if (unlockRight && reservation.rightId) {
    await transaction
      .collection(COLLECTIONS.MEMBER_RIGHTS)
      .doc(reservation.rightId)
      .update({
        data: {
          status: 'active',
          reservationId: _.remove(),
          updatedAt: new Date()
        }
      })
      .catch(() => {});
  }

  if (Object.keys(updates).length) {
    updates.updatedAt = new Date();
    await transaction.collection(COLLECTIONS.RESERVATIONS).doc(reservation._id).update({
      data: updates
    });
  }
}

function resolveCouponUsageCount(master, memberRight) {
  const meta = {
    ...(master && master.meta ? master.meta : {}),
    ...(memberRight && memberRight.meta ? memberRight.meta : {})
  };
  const numeric = Number(meta.roomUsageCount || meta.roomUsageCredits || 0);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.floor(numeric));
}
