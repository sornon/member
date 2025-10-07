function formatDateTime(date) {
  if (!date) return '';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, '0');
  const dd = String(parsed.getDate()).padStart(2, '0');
  const hh = String(parsed.getHours()).padStart(2, '0');
  const mi = String(parsed.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

Page({
  data: {
    loading: true,
    record: null,
    log: []
  },

  onLoad(options = {}) {
    this._recordResolved = false;
    const channel = this.getOpenerEventChannel ? this.getOpenerEventChannel() : null;
    if (channel && channel.on) {
      channel.on('historyRecord', (payload = {}) => {
        this.applyRecord(payload && payload.record);
      });
    }
    const applied = this.tryApplyRecordFromOptions(options);
    if (!applied) {
      setTimeout(() => {
        if (!this._recordResolved) {
          this.setData({ loading: false, record: null, log: [] });
        }
      }, 300);
    }
  },

  tryApplyRecordFromOptions(options = {}) {
    if (options && options.record) {
      try {
        const decoded = decodeURIComponent(options.record);
        const parsed = JSON.parse(decoded);
        this.applyRecord(parsed);
        return true;
      } catch (error) {
        console.warn('[pve:history] failed to parse record from options', error);
      }
    }
    return false;
  },

  applyRecord(record) {
    if (!record || record.type !== 'battle') {
      this._recordResolved = true;
      this.setData({ loading: false, record: null, log: [] });
      return;
    }
    const normalizedLog = Array.isArray(record.log) ? record.log : [];
    this._recordResolved = true;
    this.setData({
      loading: false,
      record: {
        ...record,
        createdAtText: record.createdAtText || formatDateTime(record.createdAt)
      },
      log: normalizedLog
    });
  }
});
