'use strict';

const { determineRoundOrder } = require('combat-system');
const { createActorRuntime, takeTurn } = require('skill-engine');
const { getPveCurveConfig, getPvpConfig } = require('./config-loader');

function mulberry32(seed = 1) {
  let t = seed + 0x6d2b79f5;
  return function rng() {
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildActor(build = {}, side = 'player', rng) {
  const actorRng = rng || mulberry32();
  return createActorRuntime({
    id: build.id || side,
    name: build.name || (side === 'opponent' ? '对手' : '玩家'),
    side,
    combatant: { stats: build.stats || {}, special: build.special || {} },
    skills: build.skills || [],
    rng: actorRng,
    mode: build.mode || 'pve'
  });
}

function runDuel({ actors, roundLimit, fallbackFirst = 'player' }) {
  const timeline = [];
  let round = 1;
  while (round <= roundLimit && actors.player.hp > 0 && actors.opponent.hp > 0) {
    const { order } = determineRoundOrder(actors.player, actors.opponent, {
      playerKey: 'player',
      opponentKey: 'opponent',
      fallbackFirst
    });
    let sequence = 1;
    for (let i = 0; i < order.length; i += 1) {
      if (actors.player.hp <= 0 || actors.opponent.hp <= 0) {
        break;
      }
      const actorKey = order[i];
      const actor = actors[actorKey];
      const target = actorKey === 'player' ? actors.opponent : actors.player;
      const result = takeTurn({ actor, opponent: target });
      const events = [];
      if (Array.isArray(result.preEvents)) {
        events.push(...result.preEvents);
      }
      if (Array.isArray(result.events)) {
        events.push(...result.events);
      }
      timeline.push({
        round,
        sequence,
        actor: actor.id,
        target: target.id,
        skill: result.skill,
        events,
        summary: result.summary
      });
      sequence += 1;
    }
    round += 1;
  }
  const resolvedRounds = Math.min(roundLimit, round - 1);
  const victory = actors.opponent.hp <= 0 && actors.player.hp > 0;
  const draw = !victory && actors.player.hp > 0 && actors.opponent.hp > 0;
  return {
    victory,
    draw,
    rounds: resolvedRounds,
    remaining: { player: Math.max(0, Math.round(actors.player.hp)), opponent: Math.max(0, Math.round(actors.opponent.hp)) },
    timeline
  };
}

function simulatePveBattle({ playerBuild, enemyConfig, seed, roundLimit } = {}) {
  const rng = mulberry32(seed || 1);
  const pveConfig = getPveCurveConfig();
  const limit = roundLimit || pveConfig.roundLimit || 20;
  const player = buildActor(playerBuild || {}, 'player', rng);
  const opponent = buildActor({ ...(enemyConfig || {}), mode: 'pve' }, 'opponent', rng);
  return runDuel({ actors: { player, opponent }, roundLimit: limit, fallbackFirst: 'player' });
}

function simulatePvpBattle({ playerA, playerB, seed, roundLimit } = {}) {
  const rng = mulberry32(seed || 2);
  const pvpConfig = getPvpConfig();
  const limit = roundLimit || pvpConfig.roundLimit || 15;
  const actorA = buildActor(playerA || {}, 'player', rng);
  const actorB = buildActor(playerB || {}, 'opponent', rng);
  return runDuel({ actors: { player: actorA, opponent: actorB }, roundLimit: limit, fallbackFirst: 'player' });
}

module.exports = { simulatePveBattle, simulatePvpBattle, buildActor, runDuel };
