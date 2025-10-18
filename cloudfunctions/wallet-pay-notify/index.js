const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const { COLLECTIONS, EXPERIENCE_PER_YUAN } = require('common-config');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const WECHAT_PAYMENT_SECURITY = {
  apiV3Key: (process.env.WECHAT_PAY_API_V3_KEY || '').trim()
};

let syncMemberLevel = async () => {};
try {
  const walletModule = require('../wallet/index.js');
  if (walletModule && typeof walletModule.syncMemberLevel === 'function') {
    syncMemberLevel = walletModule.syncMemberLevel;
  }
} catch (error) {
  console.error('[wallet-pay-notify] failed to load wallet helpers', error);
}

exports.main = async (event) => {
  try {
    console.log('[wallet-pay-notify] payment notify event', JSON.stringify(event || {}));
  } catch (error) {
    console.error('[wallet-pay-notify] failed to stringify event', error);
  }

  if (!event || !event.resource) {
    return { errCode: 0, errMsg: 'OK' };
  }

  const resource = event.resource;
  let payload;
  try {
    payload = decryptNotifyResource(resource);
  } catch (error) {
    console.error('[wallet-pay-notify] decrypt resource failed', error);
    throw error;
  }

  if (!payload) {
    console.warn('[wallet-pay-notify] empty payload after decrypt');
    return { errCode: 0, errMsg: 'OK' };
  }

  const tradeState = normalizeTradeState(payload.trade_state);
  const outTradeNo = toNonEmptyString(payload.out_trade_no);

  if (!outTradeNo) {
    throw new Error('支付通知缺少商户订单号');
  }

  if (tradeState === 'success') {
    await handleSuccessfulTransaction(outTradeNo, payload);
  } else if (['closed', 'payerror', 'revoked', 'refund', 'notpay'].includes(tradeState)) {
    await handleFailedTransaction(outTradeNo, payload);
  } else {
    console.log('[wallet-pay-notify] skip trade state', tradeState, payload);
  }

  return { errCode: 0, errMsg: 'OK' };
};

function decryptNotifyResource(resource) {
  if (!resource || !resource.ciphertext) {
    return null;
  }
  const keyBuffer = resolveApiV3KeyBuffer();
  const nonce = Buffer.from(resource.nonce, 'utf8');
  const associatedData = resource.associated_data ? Buffer.from(resource.associated_data, 'utf8') : null;
  const cipherBuffer = Buffer.from(resource.ciphertext, 'base64');
  if (cipherBuffer.length <= 16) {
    throw new Error('支付通知密文长度不正确');
  }
  const authTag = cipherBuffer.slice(cipherBuffer.length - 16);
  const data = cipherBuffer.slice(0, cipherBuffer.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, nonce);
  if (associatedData) {
    decipher.setAAD(associatedData);
  }
  decipher.setAuthTag(authTag);
  const decoded = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  try {
    return JSON.parse(decoded);
  } catch (error) {
    console.error('[wallet-pay-notify] parse decrypted payload failed', decoded, error);
    throw new Error('支付通知内容解析失败');
  }
}

function resolveApiV3KeyBuffer() {
  const key = WECHAT_PAYMENT_SECURITY.apiV3Key;
  if (!key) {
    throw new Error('未配置微信支付 APIv3 密钥');
  }
  const buffer = Buffer.from(key, 'utf8');
  if (buffer.length !== 32) {
    throw new Error('微信支付 APIv3 密钥长度必须为 32 字节');
  }
  return buffer;
}

function normalizeTradeState(state) {
  if (!state) {
    return '';
  }
  return String(state).trim().toLowerCase();
}

function toNonEmptyString(...candidates) {
  for (const candidate of candidates) {
    if (candidate == null) continue;
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed) return trimmed;
      continue;
    }
    try {
      const str = `${candidate}`.trim();
      if (str) return str;
    } catch (error) {
      // ignore
    }
  }
  return '';
}

async function handleSuccessfulTransaction(transactionId, payload) {
  const wxTransactionId = toNonEmptyString(payload.transaction_id);
  const payerOpenId =
    toNonEmptyString(payload.payer && (payload.payer.openid || payload.payer.sub_openid)) || '';
  const amountFromPayload = resolveAmount(payload.amount && payload.amount.total);
  let memberId = '';
  let amount = amountFromPayload;

  await db.runTransaction(async (transaction) => {
    const transactionRef = transaction.collection(COLLECTIONS.WALLET_TRANSACTIONS).doc(transactionId);
    const snapshot = await transactionRef.get().catch(() => null);
    if (!snapshot || !snapshot.data) {
      throw new Error(`找不到对应的充值记录: ${transactionId}`);
    }
    const record = snapshot.data;
    memberId = record.memberId;
    amount = resolveAmount(record.amount) || amountFromPayload;

    const now = new Date();
    const updates = {
      paymentResult: payload,
      updatedAt: now,
      wxTransactionId
    };

    if (record.status !== 'success') {
      updates.status = 'success';
      updates.paidAt = now;
    }

    await transactionRef.update({
      data: updates
    });

    if (record.status !== 'success') {
      const experienceGain = calculateExperienceGain(amount);
      const memberUpdates = {
        cashBalance: _.inc(amount),
        totalRecharge: _.inc(amount),
        updatedAt: now
      };
      if (experienceGain > 0) {
        memberUpdates.experience = _.inc(experienceGain);
      }
      await transaction.collection(COLLECTIONS.MEMBERS).doc(record.memberId).update({
        data: memberUpdates
      });
    }
  });

  if (memberId) {
    try {
      await syncMemberLevel(memberId);
    } catch (error) {
      console.error('[wallet-pay-notify] syncMemberLevel failed', memberId, error);
    }
  }

  if (payerOpenId && memberId && payerOpenId !== memberId) {
    console.warn('[wallet-pay-notify] payer openid mismatch', payerOpenId, memberId);
  }
}

async function handleFailedTransaction(transactionId, payload) {
  const failReason = toNonEmptyString(payload.trade_state_desc, payload.message, payload.summary);
  const failCode = toNonEmptyString(payload.trade_state);
  await db
    .collection(COLLECTIONS.WALLET_TRANSACTIONS)
    .doc(transactionId)
    .update({
      data: {
        status: 'failed',
        failReason: failReason ? failReason.slice(0, 200) : '支付失败',
        failCode: failCode ? failCode.slice(0, 60) : '',
        paymentResult: payload,
        updatedAt: new Date()
      }
    })
    .catch((error) => {
      console.error('[wallet-pay-notify] update failed transaction error', transactionId, error);
      throw error;
    });
}

function resolveAmount(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return 0;
  }
  return Math.max(0, Math.round(num));
}

function calculateExperienceGain(amountFen) {
  if (!amountFen || amountFen <= 0) {
    return 0;
  }
  return Math.max(0, Math.round((amountFen * EXPERIENCE_PER_YUAN) / 100));
}
