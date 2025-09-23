export const formatCurrency = (amount = 0) => {
  return `¥${(amount / 100).toFixed(2)}`;
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
  const colors = ['#a0a4ff', '#7c4dff', '#ff7e67', '#ffd166', '#4dd0e1', '#9ccc65'];
  return colors[(order - 1) % colors.length];
};
