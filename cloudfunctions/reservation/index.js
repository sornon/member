const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const COLLECTIONS = {
  ROOMS: 'rooms',
  RESERVATIONS: 'reservations',
  MEMBER_RIGHTS: 'memberRights',
  MEMBERSHIP_RIGHTS: 'membershipRights'
};

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'availableRooms';

  switch (action) {
    case 'availableRooms':
      return listAvailableRooms(OPENID, event.date, event.startTime, event.endTime);
    case 'create':
      return createReservation(OPENID, event.order || {});
    case 'cancel':
      return cancelReservation(OPENID, event.reservationId);
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

  const [roomsSnapshot, reservationsSnapshot, rightsSnapshot, rightsMaster] = await Promise.all([
    db.collection(COLLECTIONS.ROOMS)
      .where({ status: 'online' })
      .orderBy('priority', 'asc')
      .get(),
    db.collection(COLLECTIONS.RESERVATIONS)
      .where({
        date,
        status: _.in(['pendingPayment', 'reserved', 'confirmed'])
      })
      .get(),
    db.collection(COLLECTIONS.MEMBER_RIGHTS)
      .where({ memberId: openid, status: 'active' })
      .get(),
    db.collection(COLLECTIONS.MEMBERSHIP_RIGHTS).get()
  ]);

  const reservedRoomIds = new Set(
    reservationsSnapshot.data
      .map((reservation) => ({ reservation, range: normalizeReservationRange(reservation) }))
      .filter(({ range }) => range && isTimeRangeOverlap(range, requestRange))
      .map(({ reservation }) => reservation.roomId)
  );
  const now = Date.now();
  const masterMap = {};
  rightsMaster.data.forEach((item) => {
    masterMap[item._id] = item;
  });
  const validRights = rightsSnapshot.data.filter((right) => {
    if (!right.validUntil) return true;
    return new Date(right.validUntil).getTime() >= now;
  });

  return {
    rooms: roomsSnapshot.data.map((room) => {
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
    }).filter((room) => !reservedRoomIds.has(room._id))
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
    const existingReservations = await transaction
      .collection(COLLECTIONS.RESERVATIONS)
      .where({
        roomId,
        date,
        status: _.in(['pendingPayment', 'reserved', 'confirmed'])
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
      status: price === 0 ? 'reserved' : 'pendingPayment',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const res = await transaction.collection(COLLECTIONS.RESERVATIONS).add({ data: reservation });

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
    message: reservationResult.reservation.price === 0 ? '已使用权益锁定包房' : '预约创建成功，请尽快支付定金',
    reservationId: reservationResult.id,
    reservation: reservationResult.reservation
  };
}

async function cancelReservation(openid, reservationId) {
  if (!reservationId) {
    throw new Error('预约不存在');
  }
  const reservationDoc = await db.collection(COLLECTIONS.RESERVATIONS).doc(reservationId).get().catch(() => null);
  if (!reservationDoc || !reservationDoc.data) {
    throw new Error('预约不存在');
  }
  if (reservationDoc.data.memberId !== openid) {
    throw new Error('无权操作该预约');
  }
  if (reservationDoc.data.status === 'cancelled') {
    return { success: true, message: '预约已取消' };
  }

  await db.collection(COLLECTIONS.RESERVATIONS).doc(reservationId).update({
    data: {
      status: 'cancelled',
      updatedAt: new Date()
    }
  });

  if (reservationDoc.data.rightId) {
    await db.collection(COLLECTIONS.MEMBER_RIGHTS).doc(reservationDoc.data.rightId).update({
      data: {
        status: 'active',
        reservationId: _.remove()
      }
    });
  }

  return { success: true, message: '预约已取消' };
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
