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
      return listAvailableRooms(OPENID, event.date, event.slot);
    case 'create':
      return createReservation(OPENID, event.order || {});
    case 'cancel':
      return cancelReservation(OPENID, event.reservationId);
    default:
      throw new Error(`Unknown action: ${action}`);
  }
};

async function listAvailableRooms(openid, date, slot) {
  if (!date || !slot) {
    throw new Error('请提供预约日期与时段');
  }
  const [roomsSnapshot, reservationsSnapshot, rightsSnapshot, rightsMaster] = await Promise.all([
    db.collection(COLLECTIONS.ROOMS)
      .where({ status: 'online' })
      .orderBy('priority', 'asc')
      .get(),
    db.collection(COLLECTIONS.RESERVATIONS)
      .where({
        date,
        slot,
        status: _.in(['pendingPayment', 'reserved', 'confirmed'])
      })
      .get(),
    db.collection(COLLECTIONS.MEMBER_RIGHTS)
      .where({ memberId: openid, status: 'active' })
      .get(),
    db.collection(COLLECTIONS.MEMBERSHIP_RIGHTS).get()
  ]);

  const reservedRoomIds = new Set(reservationsSnapshot.data.map((item) => item.roomId));
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
      const right = validRights.find((r) => canRightApply(masterMap[r.rightId], slot));
      return {
        _id: room._id,
        name: room.name,
        capacity: room.capacity,
        facilities: (room.facilities || []).join('、'),
        price: resolvePrice(room, slot),
        isFree: Boolean(right),
        images: room.images || []
      };
    }).filter((room) => !reservedRoomIds.has(room._id))
  };
}

async function createReservation(openid, order) {
  const { roomId, date, slot, rightId } = order;
  if (!roomId || !date || !slot) {
    throw new Error('预约信息不完整');
  }
  const roomDoc = await db.collection(COLLECTIONS.ROOMS).doc(roomId).get().catch(() => null);
  if (!roomDoc || !roomDoc.data) {
    throw new Error('包房不存在');
  }

  const reservationResult = await db.runTransaction(async (transaction) => {
    const existing = await transaction
      .collection(COLLECTIONS.RESERVATIONS)
      .where({
        roomId,
        date,
        slot,
        status: _.in(['pendingPayment', 'reserved', 'confirmed'])
      })
      .count();
    if (existing.total > 0) {
      throw new Error('当前时段已被预约');
    }

    let appliedRight = null;
    let price = resolvePrice(roomDoc.data, slot);
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
      if (!masterDoc || !masterDoc.data || !canRightApply(masterDoc.data, slot)) {
        throw new Error('权益不适用于当前时段');
      }
      appliedRight = rightDoc;
      price = 0;
    }

    const reservation = {
      memberId: openid,
      roomId,
      date,
      slot,
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

function resolvePrice(room, slot) {
  if (!room || !room.pricing) return 0;
  const price = room.pricing[slot];
  return typeof price === 'number' ? price : 0;
}

function canRightApply(right, slot) {
  if (!right) return false;
  if (!right.applyReservation) return false;
  const slots = right.applySlots || [];
  if (!slots.length) return true;
  return slots.includes(slot);
}
