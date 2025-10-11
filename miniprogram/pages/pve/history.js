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

function formatCombatPower(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number') {
    return String(Math.round(value));
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object') {
    const segments = [];
    const player = value.player;
    const enemy = value.enemy;
    if (Number.isFinite(Number(player))) {
      segments.push(`我方 ${Math.round(Number(player))}`);
    }
    if (Number.isFinite(Number(enemy))) {
      segments.push(`敌方 ${Math.round(Number(enemy))}`);
    }
    if (segments.length) {
      return segments.join(' · ');
    }
    const numericValues = Object.values(value)
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v));
    if (numericValues.length) {
      return numericValues.map((v) => String(Math.round(v))).join(' / ');
    }
    return '';
  }
  return '';
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
        createdAtText: record.createdAtText || formatDateTime(record.createdAt),
        combatPowerText: record.combatPowerText || formatCombatPower(record.combatPower)
      },
      log: normalizedLog
    });
  },

  handleWatchBattle() {
    const { record } = this.data;
    if (!record || record.type !== 'battle') {
      wx.showToast({ title: '暂无战斗详情', icon: 'none' });
      return;
    }
    const battlePayload = {
      mode: 'pveReplay',
      playbackMode: 'replay',
      battle: {
        ...record,
        log: Array.isArray(record.log) ? record.log : [],
        rounds: record.battleRounds || record.rounds || [],
        remaining: record.remaining || record.resultRemaining || record.finalState || {},
        rewards: record.rewards || record.resultRewards || {}
      },
      playerProfile: record.playerProfile || record.profile || record.player || {},
      opponent: record.enemy || record.opponent || {},
      log: Array.isArray(record.log) ? record.log : []
    };
    wx.navigateTo({
      url: '/pages/pvp/battle?mode=pveReplay',
      success: (res) => {
        if (res && res.eventChannel && typeof res.eventChannel.emit === 'function') {
          res.eventChannel.emit('battle:data', battlePayload);
        }
      }
    });
  }
});
