'use strict';

/**
 * Guild service shared constants for rate limiting and cooldown configuration.
 */
const ACTION_RATE_LIMIT_WINDOWS = Object.freeze({
  create: 60 * 1000,
  createGuild: 60 * 1000,
  apply: 30 * 1000,
  approve: 15 * 1000,
  reject: 15 * 1000,
  leave: 15 * 1000,
  leaveGuild: 15 * 1000,
  kick: 15 * 1000,
  disband: 5 * 60 * 1000,
  donate: 30 * 1000,
  'tasks.list': 10 * 1000,
  'tasks.claim': 30 * 1000,
  'boss.status': 15 * 1000,
  'boss.challenge': 60 * 1000,
  'boss.rank': 30 * 1000,
  bossChallenge: 60 * 1000,
  getLeaderboard: 30 * 1000,
  joinGuild: 30 * 1000,
  initiateTeamBattle: 10 * 1000
});

const ACTION_COOLDOWN_WINDOWS = Object.freeze({
  donate: 60 * 1000,
  'tasks.claim': 45 * 1000,
  'boss.challenge': 90 * 1000,
  bossChallenge: 90 * 1000
});

const DEFAULT_BOSS_ID = 'ancient_spirit_tree';
const BOSS_SCHEMA_VERSION = 1;
const BOSS_DAILY_ATTEMPT_LIMIT = 3;
const BOSS_MEMBER_COOLDOWN_MS = 5 * 60 * 1000;
const BOSS_MAX_ROUNDS = 20;
const BOSS_RANK_LIMIT = 100;

module.exports = {
  ACTION_RATE_LIMIT_WINDOWS,
  ACTION_COOLDOWN_WINDOWS,
  DEFAULT_BOSS_ID,
  BOSS_SCHEMA_VERSION,
  BOSS_DAILY_ATTEMPT_LIMIT,
  BOSS_MEMBER_COOLDOWN_MS,
  BOSS_MAX_ROUNDS,
  BOSS_RANK_LIMIT
};
