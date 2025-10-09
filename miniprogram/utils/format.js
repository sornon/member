const FALLBACK_CURRENCY = '¥0.00';
const NESTED_AMOUNT_KEYS = ['amount', 'value', 'total', 'balance', 'cashBalance'];

function coerceToNumber(input) {
  if (input == null || input === '') {
    return 0;
  }

  if (typeof input === 'number') {
    return input;
  }

  if (typeof input === 'bigint') {
    return Number(input);
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) {
      return 0;
    }
    const sanitized = trimmed.replace(/[^0-9+.,-]/g, '').replace(/,/g, '');
    const parsed = Number(sanitized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (typeof input === 'object') {
    for (const key of NESTED_AMOUNT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(input, key)) {
        const candidate = coerceToNumber(input[key]);
        if (Number.isFinite(candidate)) {
          return candidate;
        }
      }
    }
  }

  const fallback = Number(input);
  return Number.isFinite(fallback) ? fallback : 0;
}

export const formatCurrency = (amount = 0) => {
  const numeric = coerceToNumber(amount);
  if (!Number.isFinite(numeric)) {
    return FALLBACK_CURRENCY;
  }

  const value = numeric / 100;
  const normalizedValue = Object.is(value, -0) ? 0 : value;
  return `¥${normalizedValue.toFixed(2)}`;
};

const MAX_EXPERIENCE_DIGITS = 4;

function formatWithUnit(value, divisor, unit, nextFormatter) {
  if (divisor <= 0) {
    return value.toString();
  }

  const baseValue = value / divisor;
  if (!Number.isFinite(baseValue) || baseValue === 0) {
    return `0${unit}`;
  }

  const absBaseValue = Math.abs(baseValue);
  const integerDigits = absBaseValue >= 1 ? Math.floor(absBaseValue).toString().length : 1;

  if (integerDigits >= MAX_EXPERIENCE_DIGITS) {
    const floored = Math.floor(absBaseValue);
    const text = `${baseValue < 0 ? '-' : ''}${floored}`;
    if (text.replace('-', '').length > MAX_EXPERIENCE_DIGITS && typeof nextFormatter === 'function') {
      return nextFormatter(value);
    }
    return `${text}${unit}`;
  }

  const decimalPlaces = Math.max(0, MAX_EXPERIENCE_DIGITS - integerDigits);
  let text = baseValue.toFixed(decimalPlaces);
  text = text.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1').replace(/^-0$/, '0');

  const digitCount = text.replace('-', '').replace('.', '').length;
  if (digitCount > MAX_EXPERIENCE_DIGITS) {
    if (typeof nextFormatter === 'function') {
      return nextFormatter(value);
    }
    // Fallback: trim to the maximum allowed digits.
    const parts = text.split('.');
    if (parts.length === 2) {
      const allowedFractionLength = Math.max(0, MAX_EXPERIENCE_DIGITS - parts[0].replace('-', '').length);
      text = `${parts[0]}.${parts[1].slice(0, allowedFractionLength)}`.replace(/\.0*$/, '').replace(/\.$/, '');
    } else {
      text = parts[0].slice(0, MAX_EXPERIENCE_DIGITS);
    }
  }

  if (!text) {
    text = '0';
  }

  return `${text}${unit}`;
}

export const formatExperience = (value = 0) => {
  const numeric = coerceToNumber(value);
  if (!Number.isFinite(numeric)) {
    return '0';
  }

  const normalized = Math.max(0, Math.floor(numeric));

  const formatWanYi = (amount) => formatWithUnit(amount, 1000000000000, '万亿');
  const formatYi = (amount) => formatWithUnit(amount, 100000000, '亿', formatWanYi);
  const formatWan = (amount) => formatWithUnit(amount, 10000, '万', formatYi);

  if (normalized >= 1000000000000) {
    return formatWanYi(normalized);
  }

  if (normalized >= 100000000) {
    return formatYi(normalized);
  }

  if (normalized >= 10000) {
    return formatWan(normalized);
  }

  return normalized.toString();
};

export const formatStones = (value = 0) => {
  const numeric = coerceToNumber(value);
  if (!Number.isFinite(numeric)) {
    return '0';
  }
  const normalized = Math.max(0, Math.floor(numeric));
  return normalized.toString();
};

export const formatCombatPower = (value = 0) => {
  const numeric = coerceToNumber(value);
  if (!Number.isFinite(numeric)) {
    return '0';
  }

  const normalized = Math.max(0, Math.floor(numeric));
  if (normalized >= 10000) {
    return normalized.toLocaleString('zh-CN');
  }

  return normalized.toString();
};

export const formatStoneChange = (value = 0) => {
  const numeric = coerceToNumber(value);
  if (!Number.isFinite(numeric) || numeric === 0) {
    return '0';
  }
  const prefix = numeric > 0 ? '+' : '';
  return `${prefix}${Math.abs(Math.floor(numeric)).toLocaleString('zh-CN')}`;
};

export const formatDate = (date) => {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const levelBadgeColor = (order = 1) => {
  const colors = ['#a0a4ff', '#7c4dff', '#ff7e67', '#ffd166', '#4dd0e1', '#9ccc65', '#b388ff', '#ff9f1c', '#00b894', '#ff6f91'];
  const index = Math.max((order || 1) - 1, 0) % colors.length;
  return colors[index];
};

export const formatMemberDisplayName = (nickName, realName, fallback = '') => {
  const primary = typeof nickName === 'string' ? nickName.trim() : '';
  const secondary = typeof realName === 'string' ? realName.trim() : '';
  if (primary && secondary) {
    return `${primary}（${secondary}）`;
  }
  if (primary) {
    return primary;
  }
  if (secondary) {
    return secondary;
  }
  return fallback;
};
