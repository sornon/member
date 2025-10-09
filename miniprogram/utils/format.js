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

function formatWithUnit(value, divisor, unit) {
  if (divisor <= 0) {
    return value.toString();
  }

  const baseValue = value / divisor;
  const integerDigits = Math.max(Math.floor(baseValue), 0).toString().length;
  let decimalPlaces = 0;

  if (integerDigits < 4) {
    decimalPlaces = Math.min(4, Math.max(0, 5 - integerDigits));
  } else {
    decimalPlaces = 0;
  }

  let formatted;
  if (decimalPlaces === 0) {
    formatted = Math.floor(baseValue).toString();
  } else {
    formatted = baseValue.toFixed(decimalPlaces)
      .replace(/\.0+$/, '')
      .replace(/(\.\d*?)0+$/, '$1');
    if (formatted.endsWith('.')) {
      formatted = formatted.slice(0, -1);
    }
  }

  return `${formatted}${unit}`;
}

export const formatExperience = (value = 0) => {
  const numeric = coerceToNumber(value);
  if (!Number.isFinite(numeric)) {
    return '0';
  }

  const normalized = Math.max(0, Math.floor(numeric));

  if (normalized >= 100000000) {
    return formatWithUnit(normalized, 100000000, '亿');
  }

  if (normalized >= 1000000) {
    return formatWithUnit(normalized, 10000, '万');
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
