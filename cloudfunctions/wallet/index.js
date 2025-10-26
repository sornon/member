const cloud = require('wx-server-sdk');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  EXPERIENCE_PER_YUAN,
  COLLECTIONS,
  EXCLUDED_TRANSACTION_STATUSES,
  analyzeMemberLevelProgress
} = require('common-config'); //云函数公共模块，维护在目录cloudfunctions/nodejs-layer/node_modules/common-config
const { createProxyHelpers } = require('admin-proxy');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const proxyHelpers = createProxyHelpers(cloud, { loggerTag: 'wallet' });

const FEATURE_TOGGLE_DOC_ID = 'feature_toggles';
const DEFAULT_IMMORTAL_TOURNAMENT = {
  enabled: false,
  registrationStart: '',
  registrationEnd: ''
};
const DEFAULT_FEATURE_TOGGLES = {
  cashierEnabled: true,
  immortalTournament: { ...DEFAULT_IMMORTAL_TOURNAMENT }
};

function loadRawPemFile(fileName) {
  if (!fileName) {
    return '';
  }
  try {
    const filePath = path.join(__dirname, fileName);
    if (!fs.existsSync(filePath)) {
      return '';
    }
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    console.error(`[wallet] failed to read PEM file ${fileName}`, error);
    return '';
  }
}

const LOCAL_PRIVATE_KEY = loadRawPemFile('apiclient_key.pem');
const LOCAL_PLATFORM_CERT = loadRawPemFile('apiclient_cert.pem');

const WECHAT_PAYMENT_CONFIG = {
  appId: process.env.WECHAT_PAY_APPID || 'wxada3146653042265',
  merchantId: process.env.WECHAT_PAY_MCHID || '1730096968',
  subMerchantId: process.env.WECHAT_PAY_SUB_MCHID || '',
  spAppId: process.env.WECHAT_PAY_SP_APPID || '',
  serviceProviderMode: resolveToggleBoolean(
    process.env.WECHAT_PAY_SERVICE_PROVIDER_MODE,
    false
  ),
  description: process.env.WECHAT_PAY_BODY || '会员钱包余额充值',
  callbackFunction: process.env.WECHAT_PAY_NOTIFY_FUNCTION || 'wallet-pay-notify',
  notifyUrl: process.env.WECHAT_PAY_NOTIFY_URL || '',
  clientIp: process.env.WECHAT_PAY_SPBILL_IP || '127.0.0.1'
};

const WECHAT_PAYMENT_SECURITY = {
  apiKey: trimToString(process.env.WECHAT_PAY_API_KEY || process.env.WECHAT_PAY_APIKEY || ''),
  apiV3Key: trimToString(process.env.WECHAT_PAY_API_V3_KEY || ''),
  merchantSerialNo: trimToString(process.env.WECHAT_PAY_SERIAL_NO || process.env.WECHAT_PAY_MCH_SERIAL || ''),
  privateKey:
    normalizePem(LOCAL_PRIVATE_KEY) ||
    normalizePem(process.env.WECHAT_PAY_PRIVATE_KEY || process.env.WECHAT_PAY_MCH_PRIVATE_KEY || ''),
  platformCert:
    normalizePem(LOCAL_PLATFORM_CERT) || normalizePem(process.env.WECHAT_PAY_PLATFORM_CERT || ''),
  userAgent: trimToString(process.env.WECHAT_PAY_USER_AGENT) || 'member-wallet-cloud/1.0'
};

function resolveToggleBoolean(value, defaultValue = true) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return defaultValue;
    }
    return value !== 0;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return defaultValue;
    }
    const normalized = trimmed.toLowerCase();
    if (
      ['false', '0', 'off', 'no', '关闭', '否', '禁用', '停用', 'disabled'].includes(normalized)
    ) {
      return false;
    }
    if (['true', '1', 'on', 'yes', '开启', '启用', 'enable', 'enabled'].includes(normalized)) {
      return true;
    }
    return defaultValue;
  }
  if (value == null) {
    return defaultValue;
  }
  if (typeof value.valueOf === 'function') {
    try {
      const primitive = value.valueOf();
      if (primitive !== value) {
        return resolveToggleBoolean(primitive, defaultValue);
      }
    } catch (error) {
      return defaultValue;
    }
  }
  return Boolean(value);
}

function trimToString(value) {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (value == null) {
    return '';
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  try {
    return String(value).trim();
  } catch (error) {
    return '';
  }
}

function isPemFormatted(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const hasBegin = /-----BEGIN [^-]+-----/.test(value);
  const hasEnd = /-----END [^-]+-----/.test(value);
  return hasBegin && hasEnd;
}

function stripWrappingQuotes(value) {
  if (typeof value !== 'string') {
    return value;
  }
  let result = value.trim();
  let changed = false;
  do {
    changed = false;
    if (
      (result.startsWith('"') && result.endsWith('"')) ||
      (result.startsWith("'") && result.endsWith("'"))
    ) {
      result = result.slice(1, -1).trim();
      changed = true;
    }
  } while (changed && result.length > 0);
  return result;
}

function tryDecodeBase64(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const compact = value.replace(/\s+/g, '');
  if (!compact) {
    return '';
  }
  if (/[^A-Za-z0-9+/=]/.test(compact)) {
    return '';
  }
  try {
    const decoded = Buffer.from(compact, 'base64').toString('utf8');
    return decoded || '';
  } catch (error) {
    return '';
  }
}

function normalizePem(pem) {
  if (!pem) {
    return '';
  }
  if (typeof pem !== 'string') {
    try {
      return normalizePem(String(pem));
    } catch (error) {
      return '';
    }
  }

  const trimmed = stripWrappingQuotes(pem);
  if (!trimmed) {
    return '';
  }

  const normalized = trimmed
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n');

  if (isPemFormatted(normalized)) {
    return normalized;
  }

  const decoded = stripWrappingQuotes(tryDecodeBase64(normalized)).trim();
  if (decoded) {
    const decodedNormalized = decoded
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n');
    if (isPemFormatted(decodedNormalized)) {
      return decodedNormalized;
    }
  }

  return normalized;
}

function normalizeImmortalTournament(config) {
  const normalized = { ...DEFAULT_IMMORTAL_TOURNAMENT };
  if (config && typeof config === 'object') {
    if (Object.prototype.hasOwnProperty.call(config, 'enabled')) {
      normalized.enabled = resolveToggleBoolean(config.enabled, normalized.enabled);
    }
    if (Object.prototype.hasOwnProperty.call(config, 'registrationStart')) {
      normalized.registrationStart = trimToString(config.registrationStart);
    }
    if (Object.prototype.hasOwnProperty.call(config, 'registrationEnd')) {
      normalized.registrationEnd = trimToString(config.registrationEnd);
    }
  }
  return normalized;
}

function normalizeFeatureToggles(documentData) {
  const toggles = {
    cashierEnabled: DEFAULT_FEATURE_TOGGLES.cashierEnabled,
    immortalTournament: { ...DEFAULT_FEATURE_TOGGLES.immortalTournament }
  };
  if (documentData && typeof documentData === 'object') {
    if (Object.prototype.hasOwnProperty.call(documentData, 'cashierEnabled')) {
      toggles.cashierEnabled = resolveToggleBoolean(documentData.cashierEnabled, true);
    }
    if (Object.prototype.hasOwnProperty.call(documentData, 'immortalTournament')) {
      toggles.immortalTournament = normalizeImmortalTournament(documentData.immortalTournament);
    }
  }
  return toggles;
}

async function loadFeatureToggles() {
  try {
    const snapshot = await db
      .collection(COLLECTIONS.SYSTEM_SETTINGS)
      .doc(FEATURE_TOGGLE_DOC_ID)
      .get();
    if (snapshot && snapshot.data) {
      return normalizeFeatureToggles(snapshot.data);
    }
  } catch (error) {
    if (error && error.errMsg && /not exist|not found/i.test(error.errMsg)) {
      return { ...DEFAULT_FEATURE_TOGGLES };
    }
    console.error('[wallet] loadFeatureToggles failed', error);
  }
  return { ...DEFAULT_FEATURE_TOGGLES };
}

function normalizeWineStorageEntries(list = []) {
  const normalized = [];
  (Array.isArray(list) ? list : []).forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!name) {
      return;
    }
    const rawQuantity = Number(entry.quantity || 0);
    const quantity = Number.isFinite(rawQuantity) ? Math.max(0, Math.floor(rawQuantity)) : 0;
    const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : `wine_${index}_${Date.now()}`;
    const expiresAtCandidate = entry.expiresAt ? new Date(entry.expiresAt) : null;
    const createdAtCandidate = entry.createdAt ? new Date(entry.createdAt) : null;
    const expiresAt =
      expiresAtCandidate && !Number.isNaN(expiresAtCandidate.getTime()) ? expiresAtCandidate : null;
    const createdAt =
      createdAtCandidate && !Number.isNaN(createdAtCandidate.getTime()) ? createdAtCandidate : null;
    normalized.push({
      id,
      name,
      quantity,
      expiresAt,
      createdAt
    });
  });
  return normalized.sort((a, b) => {
    const aExpiry = a.expiresAt ? a.expiresAt.getTime() : Number.POSITIVE_INFINITY;
    const bExpiry = b.expiresAt ? b.expiresAt.getTime() : Number.POSITIVE_INFINITY;
    if (aExpiry !== bExpiry) {
      return aExpiry - bExpiry;
    }
    const aCreated = a.createdAt ? a.createdAt.getTime() : 0;
    const bCreated = b.createdAt ? b.createdAt.getTime() : 0;
    return aCreated - bCreated;
  });
}

function serializeWineStorageEntry(entry) {
  if (!entry) {
    return { id: '', name: '', quantity: 0, expiresAt: '', createdAt: '' };
  }
  return {
    id: entry.id || '',
    name: entry.name || '',
    quantity: Number.isFinite(entry.quantity) ? entry.quantity : 0,
    expiresAt: entry.expiresAt instanceof Date && !Number.isNaN(entry.expiresAt.getTime()) ? entry.expiresAt.toISOString() : '',
    createdAt: entry.createdAt instanceof Date && !Number.isNaN(entry.createdAt.getTime()) ? entry.createdAt.toISOString() : ''
  };
}

function calculateWineStorageTotal(entries = []) {
  return entries.reduce((sum, entry) => {
    const qty = Number.isFinite(entry.quantity) ? entry.quantity : 0;
    return sum + Math.max(0, qty);
  }, 0);
}

function resolveCurrentEnvId() {
  try {
    const context = cloud.getWXContext();
    if (context && context.ENV) {
      return context.ENV;
    }
  } catch (error) {
    // ignore
  }
  return process.env.WX_ENV || process.env.TCB_ENV || process.env.SCF_NAMESPACE || '';
}

function extractPrepayId(packageField = '') {
  if (typeof packageField !== 'string') {
    return '';
  }
  const prefix = 'prepay_id=';
  if (packageField.startsWith(prefix)) {
    return packageField.slice(prefix.length);
  }
  if (packageField.includes('&')) {
    const match = packageField.match(/(?:^|&)prepay_id=([^&]+)/);
    if (match && match[1]) {
      return match[1];
    }
  }
  return packageField;
}

function ensurePrepayPackage(packageValue) {
  if (typeof packageValue !== 'string') {
    return '';
  }
  const trimmed = packageValue.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.startsWith('prepay_id=')) {
    return trimmed;
  }
  if (/^prepay_id\w+/.test(trimmed)) {
    return trimmed.replace(/^prepay_id/, 'prepay_id=');
  }
  return `prepay_id=${trimmed}`;
}

function generateNonceStr(length = 32) {
  if (!Number.isFinite(length) || length <= 0) {
    return '';
  }
  const characters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const maxIndex = characters.length;
  let nonce = '';
  try {
    const bytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i += 1) {
      nonce += characters[bytes[i] % maxIndex];
    }
  } catch (error) {
    for (let i = 0; i < length; i += 1) {
      const random = Math.floor(Math.random() * maxIndex);
      nonce += characters[random];
    }
  }
  return nonce;
}

function toNonEmptyString(...candidates) {
  for (const candidate of candidates) {
    if (candidate == null) {
      continue;
    }
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed) {
        return trimmed;
      }
      continue;
    }
    try {
      const value = `${candidate}`.trim();
      if (value) {
        return value;
      }
    } catch (error) {
      // ignore conversion error and move to next candidate
    }
  }
  return '';
}

function hasApiV3Credentials() {
  return (
    WECHAT_PAYMENT_CONFIG.merchantId &&
    isPemFormatted(WECHAT_PAYMENT_SECURITY.privateKey) &&
    WECHAT_PAYMENT_SECURITY.merchantSerialNo
  );
}

function signWechatPayMessage(message) {
  if (!isPemFormatted(WECHAT_PAYMENT_SECURITY.privateKey)) {
    throw new Error(
      '微信支付商户私钥格式无效，请检查 cloudfunctions/wallet/apiclient_key.pem 或环境变量 WECHAT_PAY_PRIVATE_KEY 是否包含完整的 PEM 内容'
    );
  }
  try {
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(message, 'utf8');
    signer.end();
    return signer.sign(WECHAT_PAYMENT_SECURITY.privateKey, 'base64');
  } catch (error) {
    console.error('[wallet] signWechatPayMessage failed', error);
    throw new Error(
      '微信支付商户私钥格式无效，请检查 cloudfunctions/wallet/apiclient_key.pem 或环境变量 WECHAT_PAY_PRIVATE_KEY 是否包含完整的 PEM 内容'
    );
  }
}

function requestWechatPayApi(path, bodyObject) {
  const method = 'POST';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = generateNonceStr(32);
  const body = JSON.stringify(bodyObject);
  const message = `${method}\n${path}\n${timestamp}\n${nonceStr}\n${body}\n`;
  const signature = signWechatPayMessage(message);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    Accept: 'application/json',
    'User-Agent': WECHAT_PAYMENT_SECURITY.userAgent,
    'Content-Length': Buffer.byteLength(body)
  };
  headers.Authorization =
    'WECHATPAY2-SHA256-RSA2048 ' +
    `mchid="${WECHAT_PAYMENT_CONFIG.merchantId}",` +
    `nonce_str="${nonceStr}",` +
    `signature="${signature}",` +
    `timestamp="${timestamp}",` +
    `serial_no="${WECHAT_PAYMENT_SECURITY.merchantSerialNo}"`;

  const options = {
    hostname: 'api.mch.weixin.qq.com',
    port: 443,
    path,
    method,
    headers
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        if (raw) {
          try {
            parsed = JSON.parse(raw);
          } catch (error) {
            return reject(new Error(`微信支付响应解析失败: ${raw}`));
          }
        }
        if (res.statusCode >= 400) {
          const errorMessage =
            (parsed && (parsed.message || parsed.detail || parsed.errMsg)) ||
            `微信支付接口返回错误，状态码 ${res.statusCode}`;
          const err = new Error(errorMessage);
          err.statusCode = res.statusCode;
          err.response = parsed || raw;
          return reject(err);
        }
        resolve(parsed || {});
      });
    });
    req.on('error', (error) => reject(error));
    req.write(body);
    req.end();
  });
}

function buildJsapiRequestPayload({ transactionId, amount, openid, notifyUrl, description, attach }) {
  const payload = {
    description: description || '钱包充值',
    out_trade_no: transactionId,
    attach,
    notify_url: notifyUrl,
    amount: {
      total: amount,
      currency: 'CNY'
    }
  };

  if (WECHAT_PAYMENT_CONFIG.serviceProviderMode) {
    const subMerchantId = WECHAT_PAYMENT_CONFIG.subMerchantId;
    if (!subMerchantId) {
      throw new Error('服务商模式下必须配置子商户号');
    }
    payload.sp_mchid = WECHAT_PAYMENT_CONFIG.merchantId;
    payload.sub_mchid = subMerchantId;
    if (WECHAT_PAYMENT_CONFIG.spAppId) {
      payload.sp_appid = WECHAT_PAYMENT_CONFIG.spAppId;
    }
    payload.sub_appid = WECHAT_PAYMENT_CONFIG.appId;
    payload.payer = { sub_openid: openid };
  } else {
    payload.mchid = WECHAT_PAYMENT_CONFIG.merchantId;
    payload.appid = WECHAT_PAYMENT_CONFIG.appId;
    payload.payer = { openid };
  }

  if (WECHAT_PAYMENT_CONFIG.clientIp) {
    payload.scene_info = {
      payer_client_ip: WECHAT_PAYMENT_CONFIG.clientIp
    };
  }

  return payload;
}

async function createUnifiedOrderViaApiV3({ transactionId, amount, openid, notifyUrl, description, attach }) {
  if (!hasApiV3Credentials()) {
    return null;
  }
  if (!notifyUrl) {
    throw new Error('未配置微信支付通知回调地址');
  }
  const payload = buildJsapiRequestPayload({
    transactionId,
    amount,
    openid,
    notifyUrl,
    description,
    attach
  });
  const response = await requestWechatPayApi('/v3/pay/transactions/jsapi', payload);
  if (!response || !response.prepay_id) {
    throw new Error('微信支付未返回预支付单号');
  }
  const prepayId = response.prepay_id;
  const packageValue = ensurePrepayPackage(prepayId);
  const payTimestamp = Math.floor(Date.now() / 1000).toString();
  const payNonce = generateNonceStr(32);
  const payAppId = payload.appid || payload.sub_appid || payload.sp_appid || WECHAT_PAYMENT_CONFIG.appId;
  const payMessage = `${payAppId}\n${payTimestamp}\n${payNonce}\n${packageValue}\n`;
  const paySign = signWechatPayMessage(payMessage);
  return {
    timeStamp: payTimestamp,
    nonceStr: payNonce,
    package: packageValue,
    signType: 'RSA',
    paySign,
    appId: payAppId,
    prepayId,
    channel: 'apiV3',
    apiVersion: 'v3',
    mode: WECHAT_PAYMENT_CONFIG.serviceProviderMode ? 'service-provider' : 'direct',
    rawResponse: response
  };
}

exports.main = async (event, context) => {
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
    case 'createRecharge':
      return createRecharge(targetMemberId, event.amount);
    case 'completeRecharge':
      return completeRecharge(targetMemberId, event.transactionId);
    case 'failRecharge':
      return failRecharge(targetMemberId, event.transactionId, {
        reason: event.reason,
        code: event.code,
        errMsg: event.errMsg,
        message: event.message
      });
    case 'balancePay':
      return payWithBalance(targetMemberId, event.orderId, event.amount);
    case 'loadChargeOrder':
      return loadChargeOrder(targetMemberId, event.orderId);
    case 'confirmChargeOrder':
      return confirmChargeOrder(targetMemberId, event.orderId);
    default:
      throw new Error(`Unknown action: ${action}`);
  }
};

async function getSummary(memberId) {
  const transactionsCollection = db.collection(COLLECTIONS.WALLET_TRANSACTIONS);
  const totalsPromise = resolveEffectiveTotals(transactionsCollection, memberId);
  const [memberDoc, transactionsSnapshot, totals, extrasDoc, featureToggles] = await Promise.all([
    db.collection(COLLECTIONS.MEMBERS).doc(memberId).get().catch(() => null),
    transactionsCollection
      .where({ memberId })
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get(),
    totalsPromise,
    db.collection(COLLECTIONS.MEMBER_EXTRAS).doc(memberId).get().catch(() => null),
    loadFeatureToggles()
  ]);

  const member = memberDoc && memberDoc.data ? memberDoc.data : { cashBalance: 0 };
  const transactions = transactionsSnapshot.data || [];
  const extras = extrasDoc && extrasDoc.data ? extrasDoc.data : {};
  const resolvedCashBalance = resolveCashBalance(member);
  const storedRecharge = resolveAmountNumber(member.totalRecharge);
  const storedSpend = resolveAmountNumber(member.totalSpend);
  const normalizedTotals = {
    totalRecharge: Math.max(
      0,
      Number.isFinite(storedRecharge) ? Math.max(storedRecharge, totals.totalRecharge) : totals.totalRecharge
    ),
    totalSpend: Math.max(
      0,
      Number.isFinite(storedSpend) ? Math.max(storedSpend, totals.totalSpend) : totals.totalSpend
    )
  };

  await persistMemberTotalsIfNeeded(memberId, member, normalizedTotals);

  const wineStorageEntries = normalizeWineStorageEntries(extras.wineStorage);
  const wineStorageTotal = calculateWineStorageTotal(wineStorageEntries);

  return {
    cashBalance: resolvedCashBalance,
    balance: resolvedCashBalance,
    totalRecharge: normalizedTotals.totalRecharge,
    totalSpend: normalizedTotals.totalSpend,
    wineStorage: wineStorageEntries.map((entry) => serializeWineStorageEntry(entry)),
    wineStorageTotal,
    features: featureToggles,
    transactions: transactions.map((txn) => {
      const amount = resolveAmountNumber(txn.amount);
      const status = normalizeTransactionStatus(txn.status);
      const type = resolveTransactionType(txn.type, amount);
      return {
        _id: txn._id,
        type,
        typeLabel: transactionTypeLabel[type] || transactionTypeLabel.unknown,
        amount,
        source: trimToString(txn.source),
        remark: txn.remark || '',
        createdAt: resolveDate(txn.createdAt) || new Date(),
        status,
        orderId: trimToString(txn.orderId)
      };
    })
  };
}

async function resolveEffectiveTotals(collection, memberId) {
  const pageSize = 500;
  let offset = 0;
  let totalRecharge = 0;
  let totalSpend = 0;
  let hasMore = true;
  let guard = 0;

  while (hasMore && guard < 40) {
    const snapshot = await collection
      .aggregate()
      .match({ memberId })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(pageSize)
      .project({ amount: 1, type: 1, status: 1 })
      .end()
      .catch(() => ({ list: [] }));

    const batch = Array.isArray(snapshot.list) ? snapshot.list : [];
    if (!batch.length) {
      break;
    }

    batch.forEach((txn) => {
      const amount = resolveAmountNumber(txn.amount);
      if (!Number.isFinite(amount) || amount === 0) {
        return;
      }
      const status = normalizeTransactionStatus(txn.status);
      if (EXCLUDED_TRANSACTION_STATUSES.includes(status)) {
        return;
      }
      const type = resolveTransactionType(txn.type, amount);
      if (type === 'recharge') {
        totalRecharge += Math.abs(amount);
      } else if (type === 'spend') {
        totalSpend += Math.abs(amount);
      }
    });

    if (batch.length < pageSize) {
      hasMore = false;
    } else {
      offset += pageSize;
    }

    guard += 1;
  }

  return {
    totalRecharge: Math.round(Math.max(totalRecharge, 0)),
    totalSpend: Math.round(Math.max(totalSpend, 0))
  };
}

async function persistMemberTotalsIfNeeded(memberId, member, totals) {
  if (!member || !member._id) {
    return;
  }
  const hasRechargeField = Object.prototype.hasOwnProperty.call(member, 'totalRecharge');
  const hasSpendField = Object.prototype.hasOwnProperty.call(member, 'totalSpend');
  const currentRecharge = resolveAmountNumber(member.totalRecharge);
  const currentSpend = resolveAmountNumber(member.totalSpend);
  const updates = {};

  if (!hasRechargeField || !Number.isFinite(currentRecharge) || Math.round(currentRecharge) !== totals.totalRecharge) {
    updates.totalRecharge = totals.totalRecharge;
  }
  if (!hasSpendField || !Number.isFinite(currentSpend) || Math.round(currentSpend) !== totals.totalSpend) {
    updates.totalSpend = totals.totalSpend;
  }

  if (Object.keys(updates).length) {
    updates.updatedAt = new Date();
    await db
      .collection(COLLECTIONS.MEMBERS)
      .doc(memberId)
      .update({
        data: updates
      })
      .catch(() => null);
  }
}

function resolveTransactionType(type, amount) {
  if (type) {
    return type;
  }
  if (Number.isFinite(amount)) {
    if (amount > 0) {
      return 'recharge';
    }
    if (amount < 0) {
      return 'spend';
    }
  }
  return 'unknown';
}

async function createRecharge(openid, amount) {
  const featureToggles = await loadFeatureToggles();
  if (!featureToggles.cashierEnabled) {
    throw new Error('线上充值暂不可用，请前往收款台线下充值');
  }
  const normalizedAmount = normalizeAmountInCents(amount);
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw new Error('充值金额无效');
  }
  const memberDoc = await db.collection(COLLECTIONS.MEMBERS).doc(openid).get().catch(() => null);
  const member = memberDoc && memberDoc.data ? memberDoc.data : null;
  const currentBalance = resolveCashBalance(member);
  if (currentBalance < 0 && normalizedAmount < Math.abs(currentBalance)) {
    const requiredAmount = Math.abs(currentBalance);
    const requiredYuan = (requiredAmount / 100).toFixed(2);
    const error = new Error(`当前欠款¥${requiredYuan}，请至少充值¥${requiredYuan}`);
    error.code = 'RECHARGE_BELOW_DEBT';
    error.errCode = 'RECHARGE_BELOW_DEBT';
    error.details = {
      requiredAmount,
      amount: normalizedAmount,
      balance: currentBalance,
      shortage: requiredAmount - normalizedAmount
    };
    error.data = error.details;
    error.requiredAmount = requiredAmount;
    error.balance = currentBalance;
    error.shortage = requiredAmount - normalizedAmount;
    throw error;
  }
  const now = new Date();
  const record = await db.collection(COLLECTIONS.WALLET_TRANSACTIONS).add({
    data: {
      memberId: openid,
      amount: normalizedAmount,
      type: 'recharge',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      remark: '余额充值'
    }
  });

  try {
    const payment = await createUnifiedOrder(record._id, normalizedAmount, openid);
    const sanitizedPayment = {
      timeStamp: toNonEmptyString(payment.timeStamp, payment.timestamp, payment.time),
      nonceStr: toNonEmptyString(payment.nonceStr, payment.nonce, payment.nonce_str),
      package: ensurePrepayPackage(
        toNonEmptyString(
          payment.package,
          payment.packageValue,
          payment.prepayId,
          payment.prepay_id
        )
      ),
      signType: toNonEmptyString(payment.signType, payment.sign_type) || 'RSA',
      paySign: toNonEmptyString(payment.paySign, payment.pay_sign, payment.sign, payment.signature)
    };
    const appId = toNonEmptyString(payment.appId, payment.appid, payment.appID);
    if (appId) {
      sanitizedPayment.appId = appId;
    }
    sanitizedPayment.totalFee = normalizedAmount;
    sanitizedPayment.currency = 'CNY';
    sanitizedPayment.apiVersion = payment.apiVersion || 'v2';
    sanitizedPayment.mode = WECHAT_PAYMENT_CONFIG.serviceProviderMode ? 'service-provider' : 'direct';
    if (payment.mode) {
      sanitizedPayment.mode = payment.mode;
    }
    if (payment.channel) {
      sanitizedPayment.channel = payment.channel;
    }
    if (payment.rawResponse) {
      sanitizedPayment.wechatResponse = payment.rawResponse;
    }
    const responseTransactionId = toNonEmptyString(
      payment.transactionId,
      payment.wechatTransactionId,
      payment.transaction_id
    );
    if (responseTransactionId) {
      sanitizedPayment.wechatTransactionId = responseTransactionId;
    }
    const prepayId = extractPrepayId(sanitizedPayment.package);
    if (!prepayId) {
      console.error('[wallet] sanitized payment missing prepayId', payment);
      throw new Error('支付参数生成失败，请稍后重试');
    }

    sanitizedPayment.prepayId = prepayId;

    if (
      !sanitizedPayment.timeStamp ||
      !sanitizedPayment.nonceStr ||
      !sanitizedPayment.package ||
      !sanitizedPayment.paySign
    ) {
      console.error('[wallet] unifiedOrder missing fields', payment);
      throw new Error('支付参数生成失败，请稍后重试');
    }

    await db
      .collection(COLLECTIONS.WALLET_TRANSACTIONS)
      .doc(record._id)
      .update({
        data: {
          paymentParams: sanitizedPayment,
          prepayId,
          updatedAt: new Date()
        }
      })
      .catch(() => null);

    return {
      transactionId: record._id,
      payment: sanitizedPayment
    };
  } catch (error) {
    console.error('[wallet] createUnifiedOrder failed', error);
    await db
      .collection(COLLECTIONS.WALLET_TRANSACTIONS)
      .doc(record._id)
      .remove()
      .catch(() => null);
    const message =
      (error && (error.errMsg || error.message)) || '创建支付订单失败，请稍后重试';
    throw new Error(message);
  }
}

async function createUnifiedOrder(transactionId, amount, openid) {
  const invokeUnifiedOrder =
    cloud.cloudPay && typeof cloud.cloudPay.unifiedOrder === 'function'
      ? cloud.cloudPay.unifiedOrder
      : null;
  if (typeof invokeUnifiedOrder !== 'function') {
    throw new Error('当前环境未开启云支付能力，请联系管理员配置支付参数');
  }
  if (!WECHAT_PAYMENT_CONFIG.merchantId) {
    throw new Error('未配置有效的微信支付商户号');
  }
  if (!WECHAT_PAYMENT_CONFIG.appId) {
    throw new Error('未配置有效的小程序 AppID');
  }
  const normalizedAmount = normalizeAmountInCents(amount);
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw new Error('充值金额无效');
  }

  const envId = resolveCurrentEnvId();
  let notifyUrl = '';
  if (WECHAT_PAYMENT_CONFIG.notifyUrl) {
    notifyUrl = WECHAT_PAYMENT_CONFIG.notifyUrl;
  } else if (envId && WECHAT_PAYMENT_CONFIG.callbackFunction) {
    notifyUrl = `https://${envId}.servicewechat.com/${WECHAT_PAYMENT_CONFIG.callbackFunction}`;
  }

  const attach = JSON.stringify({ scene: 'wallet_recharge', transactionId });

  if (hasApiV3Credentials()) {
    try {
      const apiV3Payment = await createUnifiedOrderViaApiV3({
        transactionId,
        amount: normalizedAmount,
        openid,
        notifyUrl,
        description: WECHAT_PAYMENT_CONFIG.description,
        attach
      });
      if (apiV3Payment) {
        return apiV3Payment;
      }
    } catch (error) {
      console.error('[wallet] createUnifiedOrderViaApiV3 failed', error);
      if (!invokeUnifiedOrder) {
        throw error;
      }
    }
  }

  const nonceStr = generateNonceStr(32);
  const requestPayload = {
    body: WECHAT_PAYMENT_CONFIG.description,
    outTradeNo: transactionId,
    totalFee: normalizedAmount,
    total_fee: normalizedAmount,
    tradeType: 'JSAPI',
    spbillCreateIp: WECHAT_PAYMENT_CONFIG.clientIp || '127.0.0.1',
    attach,
    feeType: 'CNY',
    nonceStr
  };

  if (WECHAT_PAYMENT_CONFIG.serviceProviderMode) {
    if (!WECHAT_PAYMENT_CONFIG.merchantId) {
      throw new Error('服务商商户号未配置');
    }
    requestPayload.mchId = WECHAT_PAYMENT_CONFIG.merchantId;
    const subMerchantId =
      WECHAT_PAYMENT_CONFIG.subMerchantId || WECHAT_PAYMENT_CONFIG.merchantId;
    requestPayload.subMchId = subMerchantId;
    requestPayload.subAppId = WECHAT_PAYMENT_CONFIG.appId;
    requestPayload.subOpenId = openid;
  } else {
    requestPayload.mchId = WECHAT_PAYMENT_CONFIG.merchantId;
    requestPayload.appId = WECHAT_PAYMENT_CONFIG.appId;
    requestPayload.openid = openid;
    if (WECHAT_PAYMENT_CONFIG.subMerchantId) {
      requestPayload.subMchId = WECHAT_PAYMENT_CONFIG.subMerchantId;
    }
  }

  if (envId) {
    requestPayload.envId = envId;
  }
  if (WECHAT_PAYMENT_CONFIG.callbackFunction) {
    requestPayload.functionName = WECHAT_PAYMENT_CONFIG.callbackFunction;
  }
  if (notifyUrl) {
    requestPayload.notifyUrl = notifyUrl;
  }

  const response = await invokeUnifiedOrder(requestPayload);
  if (!response) {
    throw new Error('支付参数生成失败，请稍后重试');
  }

  const { errCode, errMsg, payment, paymentData, ...rest } = response;
  if (typeof errCode !== 'undefined' && errCode !== 0) {
    const message = errMsg || rest.message || rest.errmsg || '创建支付订单失败';
    throw new Error(message);
  }

  const paymentPayload = payment || paymentData || rest.payment || rest.paymentData || rest;
  if (!paymentPayload) {
    console.error('[wallet] unifiedOrder unexpected response', response);
    throw new Error('支付参数生成失败，请稍后重试');
  }

  const returnCode = toNonEmptyString(
    paymentPayload.returnCode,
    paymentPayload.return_code,
    rest.returnCode,
    rest.return_code
  );
  if (returnCode && returnCode !== 'SUCCESS') {
    const message =
      paymentPayload.returnMsg ||
      paymentPayload.return_msg ||
      rest.returnMsg ||
      rest.return_msg ||
      paymentPayload.errCodeDes ||
      paymentPayload.err_code_des ||
      rest.errCodeDes ||
      rest.err_code_des ||
      paymentPayload.errMsg ||
      paymentPayload.err_msg ||
      '创建支付订单失败';
    throw new Error(message);
  }

  const resultCode = toNonEmptyString(
    paymentPayload.resultCode,
    paymentPayload.result_code,
    rest.resultCode,
    rest.result_code
  );
  if (resultCode && resultCode !== 'SUCCESS') {
    const message =
      paymentPayload.errCodeDes ||
      paymentPayload.err_code_des ||
      rest.errCodeDes ||
      rest.err_code_des ||
      paymentPayload.errMsg ||
      paymentPayload.err_msg ||
      rest.errMsg ||
      rest.err_msg ||
      '创建支付订单失败';
    throw new Error(message);
  }

  const normalizedPayment = {
    timeStamp: toNonEmptyString(
      paymentPayload.timeStamp,
      paymentPayload.timestamp,
      paymentPayload.time,
      paymentPayload.ts
    ),
    nonceStr: toNonEmptyString(
      paymentPayload.nonceStr,
      paymentPayload.nonce,
      paymentPayload.nonce_str,
      paymentPayload.nonceString
    ),
    package: ensurePrepayPackage(
      toNonEmptyString(
        paymentPayload.package,
        paymentPayload.packageValue,
        paymentPayload.prepayId,
        paymentPayload.prepay_id
      )
    ),
    signType: toNonEmptyString(paymentPayload.signType, paymentPayload.sign_type) || 'RSA',
    paySign: toNonEmptyString(
      paymentPayload.paySign,
      paymentPayload.pay_sign,
      paymentPayload.sign,
      paymentPayload.signature
    ),
    channel: toNonEmptyString(paymentPayload.channel, paymentPayload.payChannel)
  };

  const paymentAppId = toNonEmptyString(
    paymentPayload.appId,
    paymentPayload.appid,
    paymentPayload.appID
  );
  if (paymentAppId) {
    normalizedPayment.appId = paymentAppId;
  }

  normalizedPayment.totalFee = normalizedAmount;
  normalizedPayment.currency = 'CNY';
  normalizedPayment.apiVersion = 'v2';
  normalizedPayment.channel = normalizedPayment.channel || 'cloudPay.unifiedOrder';
  normalizedPayment.mode = WECHAT_PAYMENT_CONFIG.serviceProviderMode ? 'service-provider' : 'direct';

  const prepayId = extractPrepayId(normalizedPayment.package);
  if (!prepayId) {
    console.error('[wallet] unifiedOrder empty prepayId', paymentPayload, response);
    throw new Error('微信返回空的预支付单号，请核对金额和商户配置');
  }

  normalizedPayment.prepayId = prepayId;

  if (!normalizedPayment.timeStamp || !normalizedPayment.nonceStr || !normalizedPayment.package || !normalizedPayment.paySign) {
    console.error('[wallet] unifiedOrder missing fields', paymentPayload, response);
    throw new Error('支付参数生成失败，请稍后重试');
  }

  return normalizedPayment;
}

async function failRecharge(openid, transactionId, options = {}) {
  if (!transactionId) {
    throw new Error('充值记录不存在');
  }

  const normalizedReason = trimToString(options.reason || options.errMsg || options.message);
  const normalizedCode = trimToString(options.code || options.errCode);
  const now = new Date();

  let outcome = { success: true, status: 'failed' };

  await db.runTransaction(async (transaction) => {
    const recordRef = transaction.collection(COLLECTIONS.WALLET_TRANSACTIONS).doc(transactionId);
    const recordDoc = await recordRef.get().catch(() => null);
    if (!recordDoc || !recordDoc.data) {
      throw new Error('充值记录不存在');
    }
    const record = recordDoc.data;
    if (record.memberId !== openid) {
      throw new Error('无权操作该充值记录');
    }
    if (record.type !== 'recharge') {
      throw new Error('记录类型错误');
    }
    const currentStatus = normalizeTransactionStatus(record.status);
    if (currentStatus === 'success') {
      outcome = { success: false, status: 'success' };
      return;
    }
    if (currentStatus === 'failed') {
      outcome = { success: true, status: 'failed' };
      return;
    }

    const failureRemark = normalizedReason ? `充值失败：${normalizedReason}` : '充值失败';

    const updates = {
      status: 'failed',
      updatedAt: now,
      failedAt: now,
      remark: failureRemark.length > 120 ? `${failureRemark.slice(0, 117)}...` : failureRemark
    };

    if (normalizedReason) {
      updates.failReason = normalizedReason.slice(0, 200);
    }
    if (normalizedCode) {
      updates.failCode = normalizedCode.slice(0, 120);
    }

    await recordRef.update({
      data: updates
    });

    outcome = { success: true, status: 'failed' };
  });

  return outcome;
}

async function completeRecharge(openid, transactionId) {
  if (!transactionId) {
    throw new Error('充值记录不存在');
  }

  let result = { success: true, message: '充值成功' };
  await db.runTransaction(async (transaction) => {
    const transactionRef = transaction.collection(COLLECTIONS.WALLET_TRANSACTIONS).doc(transactionId);
    const transactionDoc = await transactionRef.get().catch(() => null);
    if (!transactionDoc || !transactionDoc.data) {
      throw new Error('充值记录不存在');
    }
    const record = transactionDoc.data;
    if (record.memberId !== openid) {
      throw new Error('无权操作该充值记录');
    }
    if (record.type !== 'recharge') {
      throw new Error('记录类型错误');
    }
    if (record.status === 'success') {
      result = { success: true, message: '充值已完成' };
      return;
    }

    const amount = record.amount || 0;
    const experienceGain = calculateExperienceGain(amount);

    await transactionRef.update({
      data: {
        status: 'success',
        updatedAt: new Date()
      }
    });

    const memberUpdate = {
      cashBalance: _.inc(amount),
      totalRecharge: _.inc(amount),
      updatedAt: new Date()
    };
    if (experienceGain > 0) {
      memberUpdate.experience = _.inc(experienceGain);
    }

    await transaction.collection(COLLECTIONS.MEMBERS).doc(openid).update({
      data: memberUpdate
    });

    result = {
      success: true,
      message: '充值成功',
      amount,
      experienceGain
    };
  });

  if (result.success) {
    await syncMemberLevel(openid);
  }

  return result;
}

async function payWithBalance(openid, orderId, amount) {
  const normalizedAmount = Number(amount);
  if (!normalizedAmount || !Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw new Error('扣款金额无效');
  }
  let experienceGain = 0;
  await db.runTransaction(async (transaction) => {
    const memberDoc = await transaction.collection(COLLECTIONS.MEMBERS).doc(openid).get();
    const member = memberDoc.data;
    const currentBalance = resolveCashBalance(member);
    if (!member || currentBalance < normalizedAmount) {
      throw new Error('余额不足');
    }
    experienceGain = calculateExperienceGain(normalizedAmount);
    await transaction.collection(COLLECTIONS.MEMBERS).doc(openid).update({
      data: {
        cashBalance: _.inc(-normalizedAmount),
        totalSpend: _.inc(normalizedAmount),
        updatedAt: new Date(),
        ...(experienceGain > 0 ? { experience: _.inc(experienceGain) } : {})
      }
    });
    await transaction.collection(COLLECTIONS.WALLET_TRANSACTIONS).add({
      data: {
        memberId: openid,
        amount: -normalizedAmount,
        type: 'spend',
        status: 'success',
        orderId: orderId || null,
        createdAt: new Date(),
        remark: '余额支付订单'
      }
    });
    if (orderId) {
      await transaction.collection(COLLECTIONS.RESERVATIONS).doc(orderId).update({
        data: {
          status: 'confirmed',
          paidAt: new Date()
        }
      });
    }
  });

  if (experienceGain > 0) {
    await syncMemberLevel(openid);
  }

  return { success: true, message: '支付成功', experienceGain };
}

async function loadChargeOrder(openid, orderId) {
  if (!orderId) {
    throw new Error('扣费单不存在');
  }
  const doc = await db
    .collection(COLLECTIONS.CHARGE_ORDERS)
    .doc(orderId)
    .get()
    .catch(() => null);
  if (!doc || !doc.data) {
    throw new Error('扣费单不存在');
  }
  const order = mapChargeOrder(doc.data, orderId);
  if (order.status === 'expired' && doc.data.status !== 'expired') {
    await db
      .collection(COLLECTIONS.CHARGE_ORDERS)
      .doc(orderId)
      .update({
        data: {
          status: 'expired',
          updatedAt: new Date()
        }
      })
      .catch(() => null);
  }
  return { order };
}

async function confirmChargeOrder(openid, orderId) {
  if (!orderId) {
    throw new Error('扣费单不存在');
  }
  let result = { success: false };
  await db.runTransaction(async (transaction) => {
    const orderRef = transaction.collection(COLLECTIONS.CHARGE_ORDERS).doc(orderId);
    const orderDoc = await orderRef.get().catch(() => null);
    if (!orderDoc || !orderDoc.data) {
      throw new Error('扣费单不存在');
    }
    const now = new Date();
    const order = orderDoc.data;
    const normalizedOrder = mapChargeOrder(order, orderId, now);
    if (normalizedOrder.status === 'expired') {
      await orderRef.update({
        data: {
          status: 'expired',
          updatedAt: now
        }
      });
      throw new Error('扣费单已过期');
    }
    if (order.status === 'paid') {
      throw new Error('扣费单已完成');
    }
    if (order.status === 'cancelled') {
      throw new Error('扣费单已取消');
    }
    const amount = Number(order.totalAmount || 0);
    if (!amount || amount <= 0) {
      throw new Error('扣费金额无效');
    }
    const memberRef = transaction.collection(COLLECTIONS.MEMBERS).doc(openid);
    const memberDoc = await memberRef.get().catch(() => null);
    if (!memberDoc || !memberDoc.data) {
      throw new Error('会员不存在');
    }
    const balance = resolveCashBalance(memberDoc.data);
    if (balance < amount) {
      throw new Error('余额不足，请先充值');
    }
    const stoneReward = Number(order.stoneReward || amount);
    await memberRef.update({
      data: {
        cashBalance: _.inc(-amount),
        totalSpend: _.inc(amount),
        stoneBalance: _.inc(stoneReward),
        updatedAt: now
      }
    });
    await transaction.collection(COLLECTIONS.WALLET_TRANSACTIONS).add({
      data: {
        memberId: openid,
        amount: -amount,
        type: 'spend',
        status: 'success',
        source: 'chargeOrder',
        orderId,
        createdAt: now,
        remark: '扫码扣费'
      }
    });
    await transaction.collection(COLLECTIONS.STONE_TRANSACTIONS).add({
      data: {
        memberId: openid,
        amount: stoneReward,
        type: 'earn',
        source: 'chargeOrder',
        description: '扫码消费赠送灵石',
        createdAt: now,
        meta: {
          orderId
        }
      }
    });
    await orderRef.update({
      data: {
        status: 'paid',
        memberId: openid,
        confirmedAt: now,
        stoneReward,
        updatedAt: now
      }
    });
    result = {
      success: true,
      message: '扣费成功',
      amount,
      stoneReward
    };
  });
  return result;
}

const transactionTypeLabel = {
  recharge: '充值',
  spend: '消费',
  reward: '奖励',
  refund: '退款',
  adjust: '调整',
  unknown: '交易'
};

function mapChargeOrder(raw, orderId, now = new Date()) {
  if (!raw) return null;
  const expireAt = resolveDate(raw.expireAt);
  let status = raw.status || 'pending';
  if (status === 'pending' && expireAt && expireAt.getTime() <= now.getTime()) {
    status = 'expired';
  }
  const items = Array.isArray(raw.items)
    ? raw.items.map((item) => ({
        name: item.name || '',
        price: Number(item.price || 0),
        quantity: Number(item.quantity || 0),
        amount: Number(item.amount || 0)
      }))
    : [];
  return {
    _id: raw._id || orderId,
    status,
    items,
    totalAmount: Number(raw.totalAmount || 0),
    stoneReward: Number(raw.stoneReward || raw.totalAmount || 0),
    createdAt: resolveDate(raw.createdAt),
    updatedAt: resolveDate(raw.updatedAt),
    expireAt,
    memberId: raw.memberId || '',
    confirmedAt: resolveDate(raw.confirmedAt)
  };
}

function resolveDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return value;
  }
  if (value && typeof value.toDate === 'function') {
    try {
      return value.toDate();
    } catch (err) {
      return null;
    }
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function calculateExperienceGain(amountFen) {
  if (!amountFen || amountFen <= 0) {
    return 0;
  }
  return Math.max(0, Math.round((amountFen * EXPERIENCE_PER_YUAN) / 100));
}

function normalizeAmountInCents(value) {
  if (value == null || value === '') {
    return NaN;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return NaN;
  }
  const rounded = Math.round(numeric);
  if (!Number.isFinite(rounded) || rounded <= 0) {
    return NaN;
  }
  return rounded;
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

function normalizeTransactionStatus(status) {
  if (!status) {
    return 'success';
  }
  if (typeof status === 'string') {
    const normalized = status.trim().toLowerCase();
    if (!normalized) {
      return 'success';
    }
    if (normalized === 'completed') {
      return 'success';
    }
    return normalized;
  }
  if (status === 'completed') {
    return 'success';
  }
  return String(status).toLowerCase();
}

async function syncMemberLevel(openid) {
  const [memberDoc, levelsSnapshot] = await Promise.all([
    db.collection(COLLECTIONS.MEMBERS).doc(openid).get().catch(() => null),
    db.collection(COLLECTIONS.MEMBERSHIP_LEVELS).orderBy('order', 'asc').get()
  ]);
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
      .catch(() => {});
  }

  for (const level of levelsToGrant) {
    await grantLevelRewards(openid, level);
  }
}

exports.syncMemberLevel = syncMemberLevel;

async function grantLevelRewards(openid, level) {
  const rewards = level.rewards || [];
  if (!rewards.length) return;
  const masterSnapshot = await db.collection(COLLECTIONS.MEMBERSHIP_RIGHTS).get();
  const masterMap = {};
  masterSnapshot.data.forEach((item) => {
    masterMap[item._id] = item;
  });
  const rightsCollection = db.collection(COLLECTIONS.MEMBER_RIGHTS);
  const now = new Date();
  for (const reward of rewards) {
    const right = masterMap[reward.rightId];
    if (!right) continue;
    const existing = await rightsCollection
      .where({ memberId: openid, rightId: reward.rightId, levelId: level._id })
      .count();
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
