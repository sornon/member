const FALLBACK_CURRENCY = '¥0.00';
const NESTED_AMOUNT_KEYS = ['amount', 'value', 'total', 'balance', 'experience'];

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
