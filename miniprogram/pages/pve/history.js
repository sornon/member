const { buildCloudAssetUrl } = require('../../shared/asset-paths');
const { PveService } = require('../../services/api');

const SECRET_REALM_BACKGROUND_VIDEO = buildCloudAssetUrl('background', 'mijing.mp4');

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
    log: [],
    replayAvailable: false
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
      this.setData({ loading: false, record: null, log: [], replayAvailable: false });
      return;
    }
    const normalizedLog = Array.isArray(record.log) ? record.log : [];
    const battleSource = record && typeof record.battle === 'object' ? record.battle : null;
    const structuredTimeline = battleSource && Array.isArray(battleSource.timeline)
      ? battleSource.timeline.filter((entry) => entry && typeof entry === 'object')
      : [];
    const archiveId = record.battleArchiveId || (battleSource && battleSource.archiveId);
    if (!structuredTimeline.length && archiveId) {
      this.loadArchiveRecord(record, archiveId, normalizedLog);
      return;
    }
    this._recordResolved = true;
    this.setData({
      loading: false,
      record: {
        ...record,
        createdAtText: record.createdAtText || formatDateTime(record.createdAt),
        combatPowerText: record.combatPowerText || formatCombatPower(record.combatPower)
      },
      log: normalizedLog,
      replayAvailable: structuredTimeline.length > 0 || normalizedLog.length > 0 || !!archiveId
    });
  },

  async loadArchiveRecord(record, archiveId, fallbackLog = []) {
    try {
      this.setData({ loading: true });
      const archive = await PveService.battleArchive(archiveId);
      const archiveBattle = archive && typeof archive.battle === 'object' ? archive.battle : null;
      const archiveTimeline = archiveBattle && Array.isArray(archiveBattle.timeline)
        ? archiveBattle.timeline.filter((entry) => entry && typeof entry === 'object')
        : [];
      const archiveLog = Array.isArray(archiveBattle && archiveBattle.log)
        ? archiveBattle.log
        : Array.isArray(archive && archive.log)
        ? archive.log
        : [];
      const mergedLog = fallbackLog.length ? fallbackLog : archiveLog;
      const mergedBattle = {
        ...(record.battle && typeof record.battle === 'object' ? record.battle : {}),
        ...(archiveBattle || {}),
        timeline: archiveTimeline,
        archiveId
      };
      const mergedRecord = {
        ...record,
        battle: mergedBattle,
        battleArchiveId: archiveId,
        log: mergedLog.length ? mergedLog : record.log,
        rounds: record.rounds || mergedBattle.rounds || archive.rounds || record.rounds
      };
      this._recordResolved = true;
      this.setData({
        loading: false,
        record: {
          ...mergedRecord,
          createdAtText: mergedRecord.createdAtText || formatDateTime(mergedRecord.createdAt),
          combatPowerText:
            mergedRecord.combatPowerText ||
            formatCombatPower(mergedRecord.combatPower || mergedBattle.combatPower || archive.combatPower)
        },
        log: mergedLog,
        replayAvailable: archiveTimeline.length > 0 || mergedLog.length > 0
      });
    } catch (error) {
      console.error('[pve:history] load archive failed', error);
      wx.showToast({ title: '战斗回放加载失败', icon: 'none' });
      this._recordResolved = true;
      this.setData({
        loading: false,
        record: {
          ...record,
          createdAtText: record.createdAtText || formatDateTime(record.createdAt),
          combatPowerText: record.combatPowerText || formatCombatPower(record.combatPower)
        },
        log: fallbackLog,
        replayAvailable: fallbackLog.length > 0
      });
    }
  },

  normalizeReplayRounds(record = {}, fallbackRounds = 0) {
    const rawRounds = Number(record.rounds);
    if (Number.isFinite(rawRounds) && rawRounds > 0) {
      return Math.max(1, Math.floor(rawRounds));
    }
    return fallbackRounds > 0 ? fallbackRounds : 0;
  },

  normalizeCombatPowerRecord(value) {
    if (!value || typeof value !== 'object') {
      return null;
    }
    const normalized = {};
    const player = Number(value.player);
    const enemy = Number(value.enemy);
    if (Number.isFinite(player)) {
      normalized.player = Math.round(player);
    }
    if (Number.isFinite(enemy)) {
      normalized.enemy = Math.round(enemy);
    }
    return Object.keys(normalized).length ? normalized : null;
  },

  normalizeRemainingState(value) {
    if (!value || typeof value !== 'object') {
      return null;
    }
    const normalized = {};
    const playerHp = Number(value.playerHp);
    const enemyHp = Number(value.enemyHp);
    if (Number.isFinite(playerHp) && playerHp >= 0) {
      normalized.playerHp = Math.max(0, Math.round(playerHp));
    }
    if (Number.isFinite(enemyHp) && enemyHp >= 0) {
      normalized.enemyHp = Math.max(0, Math.round(enemyHp));
    }
    return Object.keys(normalized).length ? normalized : null;
  },

  buildReplayPayload(record = {}) {
    if (!record || typeof record !== 'object') {
      return null;
    }
    const battleSource = record.battle && typeof record.battle === 'object' ? record.battle : record;
    const structuredTimeline = Array.isArray(battleSource.timeline)
      ? battleSource.timeline.filter((entry) => entry && typeof entry === 'object')
      : [];
    if (structuredTimeline.length) {
      const participants = battleSource.participants || record.participants || {};
      const outcome = battleSource.outcome || record.outcome || null;
      const metadata = battleSource.metadata || record.metadata || { mode: 'pve' };
      const battle = {
        ...battleSource,
        timeline: structuredTimeline,
        participants,
        outcome,
        metadata,
        log: Array.isArray(battleSource.log)
          ? battleSource.log
          : Array.isArray(record.log)
          ? record.log
          : [],
        rewards: battleSource.rewards || record.rewards || null,
        remaining: battleSource.remaining || record.remaining || null,
        combatPower: battleSource.combatPower || record.combatPower || null
      };
      const rounds = Number.isFinite(battle.rounds)
        ? Math.max(1, Math.floor(battle.rounds))
        : this.normalizeReplayRounds(battleSource, structuredTimeline.length);
      battle.rounds = rounds;
      if (typeof battle.victory !== 'boolean') {
        const rawResult = typeof record.result === 'string' ? record.result : '';
        battle.victory = rawResult === 'win';
      }
      if (typeof battle.draw !== 'boolean') {
        const rawResult = typeof record.result === 'string' ? record.result : '';
        battle.draw = rawResult === 'draw';
      }
      const combatPower = this.normalizeCombatPowerRecord(battle.combatPower);
      if (combatPower) {
        battle.combatPower = combatPower;
      }
      const remaining = this.normalizeRemainingState(battle.remaining);
      if (remaining) {
        battle.remaining = remaining;
      }
      const playerSource = participants.player || battle.player || {};
      const opponentSource =
        participants.opponent || participants.enemy || battle.opponent || battle.enemy || {};
      const viewContext = {
        playerName:
          record.playerName || playerSource.displayName || playerSource.name || '你',
        opponentName:
          record.enemyName || opponentSource.displayName || opponentSource.name || '秘境之敌'
      };
      const resolvePortrait = (source, fallback) => {
        if (typeof fallback === 'string' && fallback) {
          return fallback;
        }
        if (!source || typeof source !== 'object') {
          return '';
        }
        return source.portrait || source.avatarUrl || '';
      };
      const playerPortrait = resolvePortrait(playerSource, record.playerPortrait);
      const opponentPortrait = resolvePortrait(opponentSource, record.opponentPortrait);
      if (playerPortrait) {
        viewContext.playerPortrait = playerPortrait;
      }
      if (opponentPortrait) {
        viewContext.opponentPortrait = opponentPortrait;
      }
      const backgroundVideo =
        record.backgroundVideo ||
        (battle.background && battle.background.video) ||
        metadata.backgroundVideo ||
        '';
      if (backgroundVideo) {
        viewContext.backgroundVideo = backgroundVideo;
      }
      if (!viewContext.backgroundVideo) {
        viewContext.backgroundVideo = SECRET_REALM_BACKGROUND_VIDEO;
      }
      return { battle, viewContext };
    }

    const log = Array.isArray(battleSource.log)
      ? battleSource.log.filter((entry) => typeof entry === 'string' && entry)
      : Array.isArray(record.log)
      ? record.log.filter((entry) => typeof entry === 'string' && entry)
      : [];
    if (!log.length) {
      return null;
    }
    const rounds = this.normalizeReplayRounds(record, log.length);
    const result = typeof record.result === 'string' ? record.result : '';
    const combatPower = this.normalizeCombatPowerRecord(record.combatPower);
    const remaining = this.normalizeRemainingState(record.remaining);
    const battle = {
      victory: result === 'win',
      draw: result === 'draw',
      rounds,
      log,
      rewards: record.rewards || null
    };
    if (combatPower) {
      battle.combatPower = combatPower;
    }
    if (remaining) {
      battle.remaining = remaining;
    }
    const viewContext = {
      playerName: record.playerName || '你',
      opponentName: record.enemyName || '秘境之敌'
    };
    if (record.enemyType) {
      viewContext.enemyType = record.enemyType;
    }
    if (record.playerPortrait) {
      viewContext.playerPortrait = record.playerPortrait;
    }
    if (record.opponentPortrait) {
      viewContext.opponentPortrait = record.opponentPortrait;
    }
    if (record.backgroundVideo) {
      viewContext.backgroundVideo = record.backgroundVideo;
    }
    if (!viewContext.backgroundVideo) {
      viewContext.backgroundVideo = SECRET_REALM_BACKGROUND_VIDEO;
    }
    return { battle, viewContext };
  },

  handleReplayTap() {
    const { record } = this.data;
    if (!record) {
      return;
    }
    const payload = this.buildReplayPayload(record);
    if (!payload) {
      wx.showToast({ title: '暂无战斗回放', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: '/pages/battle/play?mode=pve&replay=1',
      success: (res) => {
        if (res && res.eventChannel && typeof res.eventChannel.emit === 'function') {
          res.eventChannel.emit('battleContext', {
            mode: 'pve',
            source: 'replay',
            battle: payload.battle,
            viewContext: payload.viewContext
          });
        }
      },
      fail: () => {
        wx.showToast({ title: '战斗画面加载失败', icon: 'none' });
      }
    });
  }
});
