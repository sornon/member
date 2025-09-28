const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const COLLECTIONS = {
  ROOMS: 'rooms',
  RESERVATIONS: 'reservations',
  MEMBER_RIGHTS: 'memberRights',
  MEMBERSHIP_RIGHTS: 'membershipRights',
  MEMBERS: 'members'
};

const RESERVATION_ACTIVE_STATUSES = [
  'pendingApproval',
  'approved',
  'reserved',
  'confirmed',
  'pendingPayment'
];

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'availableRooms';

  switch (action) {
    case 'availableRooms':
      return listAvailableRooms(OPENID, event.date, event.startTime, event.endTime);
    case 'create':
      return createReservation(OPENID, event.order || {});
    case 'cancel':
      return cancelReservation(OPENID, event.reservationId);
    case 'redeemUsageCoupon':
      return redeemRoomUsageCoupon(OPENID, event.memberRightId);
    default:
      throw new Error(`Unknown action: ${action}`);
  }
};

async function listAvailableRooms(openid, date, startTime, endTime) {
  if (!date || !startTime || !endTime) {
    throw new Error('请提供预约日期与时间');
  }
  const requestRange = normalizeTimeRange(startTime, endTime);
  if (!requestRange) {
    throw new Error('预约时间不正确');
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
        date,
        status: _.in(RESERVATION_ACTIVE_STATUSES)
      })
      .get(),
    db
      .collection(COLLECTIONS.MEMBER_RIGHTS)
      .where({ memberId: openid, status: 'active' })
      .get(),
    db.collection(COLLECTIONS.MEMBERSHIP_RIGHTS).get(),
    db
      .collection(COLLECTIONS.RESERVATIONS)
      .where({
        memberId: openid,
        status: _.in(['pendingApproval', 'approved', 'rejected'])
      })
      .orderBy('date', 'desc')
      .orderBy('startTime', 'desc')
      .limit(1)
      .get(),
    db
      .collection(COLLECTIONS.MEMBERS)
      .doc(openid)
      .get()
      .catch(() => null)
  ]);

  const reservedRoomIds = new Set(
    reservationsSnapshot.data
      .map((reservation) => ({ reservation, range: normalizeReservationRange(reservation) }))
      .filter(({ range }) => range && isTimeRangeOverlap(range, requestRange))
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
  const notice = buildMemberReservationNotice(
    memberReservationSnapshot.data,
    roomsSnapshot.data,
    usageCount
  );

  return {
    rooms,
    notice,
    memberUsageCount: usageCount
  };
}

async function createReservation(openid, order) {
  const { roomId, date, startTime, endTime, rightId } = order;
  if (!roomId || !date || !startTime || !endTime) {
    throw new Error('预约信息不完整');
  }
  const requestRange = normalizeTimeRange(startTime, endTime);
  if (!requestRange) {
    throw new Error('预约时间不正确');
  }
  const roomDoc = await db.collection(COLLECTIONS.ROOMS).doc(roomId).get().catch(() => null);
  if (!roomDoc || !roomDoc.data) {
    throw new Error('包房不存在');
  }

  const reservationResult = await db.runTransaction(async (transaction) => {
    const memberSnapshot = await transaction
      .collection(COLLECTIONS.MEMBERS)
      .doc(openid)
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
        date,
        status: _.in(RESERVATION_ACTIVE_STATUSES)
      })
      .get();

    const hasConflict = existingReservations.data.some((reservation) => {
      const range = normalizeReservationRange(reservation);
      if (!range) return false;
      return isTimeRangeOverlap(range, requestRange);
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
      if (!right || right.memberId !== openid || right.status !== 'active') {
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
      memberId: openid,
      roomId,
      date,
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

    await transaction.collection(COLLECTIONS.MEMBERS).doc(openid).update({
      data: {
        roomUsageCount: Math.max(0, usageCount - 1),
        updatedAt: new Date()
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

  return {
    success: true,
    message: '预约申请已提交，请等待管理员审核',
    reservationId: reservationResult.id,
    reservation: reservationResult.reservation
  };
}

async function cancelReservation(openid, reservationId) {
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
    if (reservation.memberId !== openid) {
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

  return { success: true, message: '预约已取消' };
}

async function redeemRoomUsageCoupon(openid, memberRightId) {
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
    if (right.memberId !== openid) {
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

    await transaction.collection(COLLECTIONS.MEMBERS).doc(openid).update({
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

function normalizeTimeRange(startTime, endTime) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  if (start >= end) {
    return null;
  }
  return {
    start,
    end,
    startLabel: formatTimeLabel(start),
    endLabel: formatTimeLabel(end)
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

function normalizeReservationRange(reservation) {
  if (!reservation) return null;
  const range = normalizeTimeRange(reservation.startTime, reservation.endTime);
  if (range) {
    return range;
  }
  if (reservation.slot) {
    const slotRanges = {
      day: normalizeTimeRange('12:00', '18:00'),
      night: normalizeTimeRange('18:00', '24:00'),
      late: normalizeTimeRange('00:00', '06:00')
    };
    return slotRanges[reservation.slot] || null;
  }
  return null;
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
  if (latest.status === 'approved') {
    return {
      type: 'success',
      message: `已预约成功：${roomName}，请于 ${latest.date} ${latest.startTime} 入场。`,
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
    return {
      type: 'warning',
      message: '该房间已被其他会员锁定，请重新选择时间。',
      closable: true,
      reservationId: latest._id
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
