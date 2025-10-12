import { PveService, PvpService } from '../../services/api';
const {
  createBattleViewModel,
  DEFAULT_BACKGROUND_VIDEO,
  DEFAULT_PLAYER_IMAGE,
  DEFAULT_OPPONENT_IMAGE
} = require('../../shared/battle');
const {
  resolveBackgroundByRealmName,
  resolveBackgroundById,
  normalizeBackgroundId
} = require('../../shared/backgrounds');
const { CHARACTER_IMAGE_BASE_PATH } = require('../../shared/asset-paths');
const { listAvatarIds } = require('../../shared/avatar-catalog');

function buildCharacterImageMap() {
  const ids = listAvatarIds();
  return ids.reduce((acc, id) => {
    acc[id] = `${CHARACTER_IMAGE_BASE_PATH}/${id}.png`;
    return acc;
  }, {});
}

const CHARACTER_IMAGE_MAP = buildCharacterImageMap();
const AVATAR_URL_PATTERN = /\/assets\/avatar\/((male|female)-[a-z]+-\d+)\.png(?:\?.*)?$/;

function extractAvatarIdFromUrl(url) {
  if (typeof url !== 'string') {
    return '';
  }
  const match = url.trim().toLowerCase().match(AVATAR_URL_PATTERN);
  return match ? match[1] : '';
}

function resolveCharacterPortraitFromAvatarUrl(url) {
  const avatarId = extractAvatarIdFromUrl(url);
  if (avatarId && CHARACTER_IMAGE_MAP[avatarId]) {
    return CHARACTER_IMAGE_MAP[avatarId];
  }
  return '';
}

function resolvePortraitCandidate(candidate) {
  if (!candidate) {
    return '';
  }
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (!trimmed) {
      return '';
    }
    const characterPortrait = resolveCharacterPortraitFromAvatarUrl(trimmed);
    return characterPortrait || trimmed;
  }
  if (typeof candidate === 'object') {
    const directPortrait = resolvePortraitCandidate(candidate.portrait);
    if (directPortrait) {
      return directPortrait;
    }
    return resolvePortraitCandidate(candidate.avatarUrl);
  }
  return '';
}

function pickBattlePortrait(fallback, ...candidates) {
  for (let i = 0; i < candidates.length; i += 1) {
    const resolved = resolvePortraitCandidate(candidates[i]);
    if (resolved) {
      return resolved;
    }
  }
  return fallback;
}

function resolveParticipantByAliases(participants, aliases = []) {
  if (!participants || typeof participants !== 'object' || !Array.isArray(aliases)) {
    return null;
  }
  for (let i = 0; i < aliases.length; i += 1) {
    const key = aliases[i];
    if (!key) {
      continue;
    }
    const candidate = participants[key];
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

const MIN_SKIP_SECONDS = 10;

function createBattleStageState(overrides = {}) {
  return {
    loading: true,
    error: '',
    backgroundVideo: DEFAULT_BACKGROUND_VIDEO,
    player: null,
    opponent: null,
    hpState: {
      player: { max: 1, current: 1, percent: 100 },
      opponent: { max: 1, current: 1, percent: 100 }
    },
    currentAction: {},
    displayedLogs: [],
    skipLocked: true,
    skipButtonText: `跳过（${MIN_SKIP_SECONDS}）`,
    battleFinished: false,
    resultTitle: '',
    resultSubtitle: '',
    resultClass: '',
    resultRounds: 0,
    ...overrides
  };
}

function resolveBackgroundVideoById(backgroundId) {
  const normalized = normalizeBackgroundId(backgroundId || '');
  if (!normalized) {
    return '';
  }
  const background = resolveBackgroundById(normalized);
  if (!background || !background.video) {
    return '';
  }
  return background.video;
}

function extractRealmName(enemy = {}) {
  if (enemy && typeof enemy.realmName === 'string' && enemy.realmName.trim()) {
    return enemy.realmName.trim();
  }
  if (enemy && typeof enemy.stageName === 'string') {
    const parts = enemy.stageName.split('·');
    if (parts.length && parts[0].trim()) {
      return parts[0].trim();
    }
  }
  return '';
}

function resolvePveSceneBackground(enemy = {}) {
  if (!enemy || typeof enemy !== 'object') {
    return '';
  }
  const scene = enemy.scene || enemy.environment || {};
  if (scene && typeof scene.video === 'string' && scene.video) {
    return scene.video;
  }
  if (scene && typeof scene.backgroundVideo === 'string' && scene.backgroundVideo) {
    return scene.backgroundVideo;
  }
  if (typeof enemy.backgroundVideo === 'string' && enemy.backgroundVideo) {
    return enemy.backgroundVideo;
  }
  const sceneBackgroundId =
    (scene && scene.backgroundId) ||
    (enemy.background && enemy.background.id) ||
    enemy.backgroundId ||
    '';
  const resolvedById = resolveBackgroundVideoById(sceneBackgroundId);
  if (resolvedById) {
    return resolvedById;
  }
  const realmName = extractRealmName(enemy);
  if (realmName) {
    const background = resolveBackgroundByRealmName(realmName);
    if (background && background.video) {
      return background.video;
    }
  }
  return '';
}

function extractBackgroundVideoFromSource(source) {
  if (!source) {
    return '';
  }
  if (typeof source === 'string') {
    return source;
  }
  if (source.background && typeof source.background.video === 'string' && source.background.video) {
    return source.background.video;
  }
  if (typeof source.backgroundVideo === 'string' && source.backgroundVideo) {
    return source.backgroundVideo;
  }
  if (typeof source.video === 'string' && source.video) {
    return source.video;
  }
  if (source.defenderBackground) {
    return extractBackgroundVideoFromSource(source.defenderBackground);
  }
  if (typeof source.appearanceBackgroundId === 'string') {
    const resolved = resolveBackgroundVideoById(source.appearanceBackgroundId);
    if (resolved) {
      return resolved;
    }
  }
  if (source.background && typeof source.background.id === 'string') {
    const resolved = resolveBackgroundVideoById(source.background.id);
    if (resolved) {
      return resolved;
    }
  }
  if (typeof source.backgroundId === 'string') {
    const resolved = resolveBackgroundVideoById(source.backgroundId);
    if (resolved) {
      return resolved;
    }
  }
  return '';
}

function resolvePvpDefenderBackgroundVideo({ battle = {}, preview = null, source = '' } = {}) {
  const candidates = [];
  const options = battle && battle.options ? battle.options : {};
  const player = battle && battle.player ? battle.player : {};
  const opponent = battle && battle.opponent ? battle.opponent : {};
  const defenderId = options.defenderId || '';
  if (defenderId) {
    if (player && player.memberId === defenderId) {
      candidates.push(player);
    } else if (opponent && opponent.memberId === defenderId) {
      candidates.push(opponent);
    }
  }
  if (!candidates.length) {
    if (source === 'acceptInvite') {
      candidates.push(player);
    } else if (options.inviteMatch && options.initiatorId && options.initiatorId !== player.memberId) {
      candidates.push(player);
    } else if (opponent && Object.keys(opponent).length) {
      candidates.push(opponent);
    }
  }
  if (preview) {
    candidates.push(preview);
  }
  for (let i = 0; i < candidates.length; i += 1) {
    const video = extractBackgroundVideoFromSource(candidates[i]);
    if (video) {
      return video;
    }
  }
  return '';
}

Page({
  data: {
    navTitle: '战斗演武',
    ...createBattleStageState(),
    actions: [],
    currentRound: 1,
    skipCountdown: MIN_SKIP_SECONDS,
    battleState: 'loading',
    battleStage: createBattleStageState()
  },

  onLoad(options = {}) {
    this.mode = options.mode === 'pvp' ? 'pvp' : 'pve';
    this.isReplay = options.replay === '1' || options.replay === true;
    this.contextOptions = options;
    this.navInitialized = false;
    this.setData({
      navTitle: this.isReplay ? '战斗回放' : this.mode === 'pvp' ? '竞技对决' : '秘境对战'
    });
    this.openerChannel = this.getOpenerEventChannel ? this.getOpenerEventChannel() : null;
    if (this.openerChannel && this.openerChannel.on) {
      this.openerChannel.on('battleContext', (payload = {}) => {
        this.contextPayload = payload || {};
        this.bootstrap();
      });
    }
    if (options.matchId) {
      this.contextPayload = { ...this.contextPayload, matchId: options.matchId, source: 'replay' };
      this.bootstrap();
    } else if (!this.openerChannel) {
      this.bootstrap();
    }
  },

  onUnload() {
    this.clearTimers();
  },

  bootstrap() {
    if (this._bootstrapped) {
      return;
    }
    this._bootstrapped = true;
    this.loadBattle();
  },

  async loadBattle() {
    this.clearTimers();
    this.setBattleStageData({ loading: true, error: '', battleFinished: false });
    this.setData({ battleState: 'loading' });
    const context = this.contextPayload || {};
    try {
      let serviceResult = null;
      let battleData = null;
      let viewContext = {};
      if (this.isReplay || context.source === 'replay') {
        if (this.mode === 'pvp') {
          const matchId = context.matchId || this.contextOptions.matchId;
          if (!matchId) {
            throw new Error('未找到战报');
          }
          battleData = await PvpService.battleReplay(matchId);
          const participants = (battleData && battleData.participants) || {};
          const playerParticipant =
            resolveParticipantByAliases(participants, ['player', 'self', 'attacker', 'initiator', 'ally', 'member']) || null;
          const opponentParticipant =
            resolveParticipantByAliases(participants, ['opponent', 'enemy', 'defender', 'target', 'foe']) || null;
          viewContext = {
            playerPortrait: pickBattlePortrait(
              DEFAULT_PLAYER_IMAGE,
              context.playerPortrait,
              playerParticipant,
              battleData.player
            ),
            opponentPortrait: pickBattlePortrait(
              DEFAULT_OPPONENT_IMAGE,
              context.opponentPortrait,
              opponentParticipant,
              battleData.opponent
            ),
            playerName: battleData.player ? battleData.player.displayName : '我方',
            opponentName: battleData.opponent ? battleData.opponent.displayName : '对手',
            playerPower: battleData.player ? battleData.player.pointsAfter : '',
            opponentPower: battleData.opponent ? battleData.opponent.pointsAfter : ''
          };
          const replayBackground =
            resolvePvpDefenderBackgroundVideo({
              battle: battleData,
              source: context.source || this.contextOptions.source || ''
            }) || DEFAULT_BACKGROUND_VIDEO;
          viewContext.backgroundVideo = replayBackground;
        } else {
          battleData = context.battle || null;
          viewContext = context.viewContext || {};
          if (!battleData) {
            throw new Error('暂无战斗回放数据');
          }
        }
      } else if (this.mode === 'pve') {
        const enemyId = context.enemyId || this.contextOptions.enemyId;
        if (!enemyId) {
          throw new Error('未找到敌方信息');
        }
        serviceResult = await PveService.battle(enemyId);
        battleData = serviceResult.battle;
        const participants = (battleData && battleData.participants) || {};
        const playerParticipant = participants.player || participants.self || {};
        const playerCombatPower = playerParticipant ? playerParticipant.combatPower : undefined;
        let playerPowerValue = '';
        if (Number.isFinite(playerCombatPower)) {
          playerPowerValue = Math.round(playerCombatPower);
        } else if (typeof playerCombatPower === 'string' && playerCombatPower.trim()) {
          playerPowerValue = playerCombatPower.trim();
        } else if (Number.isFinite(context.playerPower)) {
          playerPowerValue = Math.round(context.playerPower);
        } else if (typeof context.playerPower === 'string' && context.playerPower.trim()) {
          playerPowerValue = context.playerPower.trim();
        }
        const enemy = context.enemyPreview || {};
        const sceneBackground = resolvePveSceneBackground(enemy);
        viewContext = {
          playerName:
            playerParticipant.displayName ||
            playerParticipant.name ||
            context.playerName ||
            '你',
          playerPortrait: pickBattlePortrait(
            DEFAULT_PLAYER_IMAGE,
            context.playerPortrait,
            playerParticipant
          ),
          playerPower: playerPowerValue,
          opponentName: enemy.name || '秘境之敌',
          opponentPortrait: pickBattlePortrait(
            DEFAULT_OPPONENT_IMAGE,
            context.opponentPortrait,
            enemy
          ),
          backgroundVideo: sceneBackground || context.backgroundVideo || DEFAULT_BACKGROUND_VIDEO
        };
        this.parentPayload = {
          type: 'pve',
          battle: serviceResult.battle || null
        };
        this.notifyParent();
      } else {
        const action = context.source || 'random';
        if (action === 'acceptInvite') {
          serviceResult = await PvpService.acceptInvite(context.inviteId || '');
        } else if (action === 'challenge') {
          serviceResult = await PvpService.matchFriend(context.targetId || '');
        } else {
          serviceResult = await PvpService.matchRandom();
        }
        battleData = serviceResult.battle;
        const profile = serviceResult.profile || {};
        const member = profile.memberSnapshot || profile.member || {};
        const opponent = (serviceResult.opponent && serviceResult.opponent) || {};
        viewContext = {
          playerName: member.nickName || member.name || '我方',
          playerPortrait: pickBattlePortrait(
            DEFAULT_PLAYER_IMAGE,
            context.playerPortrait,
            member,
            battleData && battleData.player
          ),
          playerPower:
            (battleData && battleData.player && battleData.player.pointsAfter) ||
            (serviceResult.profile ? serviceResult.profile.points : ''),
          opponentName:
            opponent.nickName || (battleData && battleData.opponent && battleData.opponent.displayName) || '对手',
          opponentPortrait: pickBattlePortrait(
            DEFAULT_OPPONENT_IMAGE,
            context.opponentPortrait,
            opponent,
            battleData && battleData.opponent
          ),
          opponentPower:
            (battleData && battleData.opponent && battleData.opponent.pointsAfter) || opponent.points || ''
        };
        const liveBackground =
          resolvePvpDefenderBackgroundVideo({
            battle: battleData,
            preview: serviceResult.opponent,
            source: context.source || this.contextOptions.source || ''
          }) || DEFAULT_BACKGROUND_VIDEO;
        viewContext.backgroundVideo = liveBackground;
        this.parentPayload = {
          type: 'pvp',
          profile: serviceResult.profile || null,
          battle: serviceResult.battle || null,
          opponent: serviceResult.opponent || null,
          season: serviceResult.season || null,
          recentMatches: serviceResult.recentMatches || null,
          leaderboardPreview: serviceResult.leaderboardPreview || null,
          leaderboardUpdatedAt: serviceResult.leaderboardUpdatedAt || null
        };
        this.notifyParent();
      }

      if (!battleData) {
        throw new Error('战斗数据为空');
      }
      this.latestBattle = battleData;
      const viewModel = createBattleViewModel({ mode: this.mode, battle: battleData, context: viewContext });
      this.applyBattleViewModel(viewModel);
    } catch (error) {
      console.error('[battle/play] load battle failed', error);
      const message = error && (error.errMsg || error.message) ? error.errMsg || error.message : '战斗加载失败';
      wx.showToast({ title: message, icon: 'none' });
      this.setBattleStageData({ loading: false, error: message });
      this.setData({ battleState: 'error' });
    }
  },

  applyBattleViewModel(viewModel) {
    const skipLocked = !this.isReplay;
    this.initialHp = {
      player: viewModel.player.hp,
      opponent: viewModel.opponent.hp
    };
    this.setBattleStageData({
      loading: false,
      error: '',
      backgroundVideo: viewModel.backgroundVideo || DEFAULT_BACKGROUND_VIDEO,
      player: viewModel.player,
      opponent: viewModel.opponent,
      hpState: {
        player: viewModel.player.hp,
        opponent: viewModel.opponent.hp
      },
      currentAction: {},
      displayedLogs: [],
      skipLocked,
      skipButtonText: skipLocked ? `跳过（${MIN_SKIP_SECONDS}）` : '跳过战斗',
      battleFinished: false,
      resultTitle: '',
      resultSubtitle: '',
      resultClass: '',
      resultRounds: viewModel.result.rounds || viewModel.actions.length
    });
    this.setData({
      actions: viewModel.actions,
      currentRound: 1,
      skipCountdown: skipLocked ? MIN_SKIP_SECONDS : 0,
      battleState: 'ready'
    });
    this.battleResultMeta = viewModel.result || {};
    this.clearTimers();
    this.timelineIndex = -1;
    if (skipLocked) {
      this.startSkipCountdown();
    }
    this.scheduleNextAction(600);
  },

  scheduleNextAction(delay = 1200) {
    this.clearActionTimer();
    if (!Array.isArray(this.data.actions) || !this.data.actions.length) {
      this.finishBattle();
      return;
    }
    this._actionTimer = setTimeout(() => {
      this.advanceAction();
    }, delay);
  },

  advanceAction() {
    const actions = this.data.actions || [];
    const currentIndex = typeof this.timelineIndex === 'number' ? this.timelineIndex : -1;
    const nextIndex = currentIndex + 1;
    if (nextIndex >= actions.length) {
      this.finishBattle();
      return;
    }
    const action = actions[nextIndex];
    const nextLogs = [...this.data.displayedLogs, { id: action.id, text: action.description }].slice(-5);
    const nextHpState = action.hp || this.data.hpState;
    this.timelineIndex = nextIndex;
    this.setBattleStageData({
      currentAction: action,
      displayedLogs: nextLogs,
      hpState: nextHpState
    });
    this.setData({ battleState: 'playing', currentRound: action.round || this.data.currentRound });
    const delay = action.type === 'result' ? 2200 : 1400;
    this.scheduleNextAction(delay);
  },

  finishBattle() {
    this.clearTimers();
    if (this.data.battleFinished) {
      return;
    }
    const result = this.battleResultMeta || {};
    const victory = !!result.victory;
    const draw = !!result.draw;
    const resultTitle = draw ? '势均力敌' : victory ? '战斗胜利' : '战斗惜败';
    let resultSubtitle = '';
    if (this.mode === 'pve') {
      if (victory && result.rewards) {
        const stones = result.rewards.stones || 0;
        const attributePoints = result.rewards.attributePoints || 0;
        const segments = [];
        if (stones) segments.push(`${stones} 灵石`);
        if (attributePoints) segments.push(`${attributePoints} 属性点`);
        resultSubtitle = segments.length ? `获得 ${segments.join('、')}` : '继续深入秘境收集更多奖励';
      } else if (draw) {
        resultSubtitle = '灵力耗尽，双方暂且休战。';
      } else {
        resultSubtitle = '敌手强劲，回去整顿后再战。';
      }
    } else {
      if (victory && this.parentPayload && this.parentPayload.battle && this.parentPayload.battle.player) {
        const delta = this.parentPayload.battle.player.pointsDelta;
        if (typeof delta === 'number' && delta !== 0) {
          resultSubtitle = `积分变化 ${delta >= 0 ? '+' : ''}${Math.round(delta)}`;
        }
      }
      if (!resultSubtitle) {
        resultSubtitle = draw ? '积分未有波动，胜负待定。' : victory ? '声名远扬，连战连捷。' : '略逊一筹，继续磨砺。';
      }
    }
    const resultClass = draw ? 'draw' : victory ? 'victory' : 'defeat';
    this.setBattleStageData({
      battleFinished: true,
      resultTitle,
      resultSubtitle,
      resultClass,
      resultRounds: result.rounds || this.timelineIndex + 1,
      skipLocked: false,
      skipButtonText: '重播战斗'
    });
    this.setData({ battleState: 'finished' });
  },

  handleSkip() {
    if (this.data.battleFinished) {
      this.restartBattle();
      return;
    }
    if (this.data.skipLocked) {
      return;
    }
    this.clearTimers();
    const actions = this.data.actions || [];
    if (actions.length) {
      const lastAction = actions[actions.length - 1];
      this.setBattleStageData({
        currentAction: lastAction,
        displayedLogs: [...this.data.displayedLogs, { id: lastAction.id, text: lastAction.description }].slice(-5),
        hpState: lastAction.hp || this.data.hpState
      });
      this.setData({ currentRound: lastAction.round || this.data.currentRound });
    }
    this.finishBattle();
  },

  handleExit() {
    wx.navigateBack({ delta: 1 });
  },

  restartBattle() {
    const actions = this.data.actions || [];
    if (!actions.length) {
      return;
    }
    this.clearTimers();
    this.timelineIndex = -1;
    this.setBattleStageData({
      battleFinished: false,
      currentAction: {},
      displayedLogs: [],
      hpState: {
        player: this.initialHp ? this.initialHp.player : this.data.hpState.player,
        opponent: this.initialHp ? this.initialHp.opponent : this.data.hpState.opponent
      },
      skipLocked: false,
      skipButtonText: '跳过战斗'
    });
    this.setData({ battleState: 'playing', currentRound: 1, skipCountdown: 0 });
    this.scheduleNextAction(400);
  },

  startSkipCountdown() {
    this.clearSkipTimer();
    this.setBattleStageData({ skipLocked: true, skipButtonText: `跳过（${MIN_SKIP_SECONDS}）` });
    this.setData({ skipCountdown: MIN_SKIP_SECONDS });
    let remaining = MIN_SKIP_SECONDS;
    this._skipTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        this.clearSkipTimer();
        this.setBattleStageData({ skipLocked: false, skipButtonText: '跳过战斗' });
        this.setData({ skipCountdown: 0 });
      } else {
        this.setBattleStageData({ skipButtonText: `跳过（${remaining}）` });
        this.setData({ skipCountdown: remaining });
      }
    }, 1000);
  },

  notifyParent() {
    if (!this.openerChannel || typeof this.openerChannel.emit !== 'function' || !this.parentPayload) {
      return;
    }
    if (this._parentNotified) {
      return;
    }
    this._parentNotified = true;
    this.openerChannel.emit('battleFinished', this.parentPayload);
  },

  clearTimers() {
    this.clearActionTimer();
    this.clearSkipTimer();
  },

  clearActionTimer() {
    if (this._actionTimer) {
      clearTimeout(this._actionTimer);
      this._actionTimer = null;
    }
  },

  clearSkipTimer() {
    if (this._skipTimer) {
      clearInterval(this._skipTimer);
      this._skipTimer = null;
    }
  },

  setBattleStageData(updates = {}) {
    if (!updates || typeof updates !== 'object') {
      return;
    }
    const nextStage = {
      ...this.data.battleStage,
      ...updates
    };
    const dataUpdates = { battleStage: nextStage };
    Object.keys(updates).forEach((key) => {
      dataUpdates[key] = nextStage[key];
    });
    this.setData(dataUpdates);
  }
});
