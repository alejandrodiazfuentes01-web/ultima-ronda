/**
 * Jugador automático: juega sin gráficos para detectar bloqueos.
 *
 * No intenta jugar bien, sino recorrer el juego entero: compra el SMG-5, abre
 * la puerta, dispara a la cabeza del enemigo más cercano y recompra munición.
 * Es invulnerable y su daño se multiplica para que 30 rondas tarden segundos.
 *
 * Detecta tres fallos: enemigos atascados, rondas que no terminan y puntos negativos.
 */
import type { GameConfig } from '../config';
import { SIM_DT } from '../sim/fixedStep';
import { Game } from '../sim/game';
import { EYE_HEIGHT } from '../sim/physics';
import { emptyInput, type PlayerInput } from '../sim/types';

/** Puesto del jugador automático: delante de la puerta, para ver entrar a los del laboratorio. */
const POST_BEFORE_DOOR = 1.7;
const HEAD_HEIGHT = 1.6;

/** Límites de la vigilancia. */
const MAX_ROUND_SECONDS = 15 * 60;
const MAX_SECONDS_TO_ENTER = 60;
const STUCK_SECONDS = 15;
const STUCK_DISTANCE = 0.5;

export interface BotReport {
  roundsCompleted: number;
  simSeconds: number;
  kills: number;
  doorOpened: boolean;
  problems: string[];
}

export interface BotOptions {
  rounds: number;
  seed?: number;
  damageScale?: number;
}

export function runBot(cfg: GameConfig, opts: BotOptions): BotReport {
  const game = new Game(cfg, { seed: opts.seed ?? 1, invulnerable: true, damageScale: opts.damageScale ?? 20 });
  const problems: string[] = [];
  const watch = game.enemies.map(() => ({ since: 0, x: 0, z: 0 }));
  let roundStartTick = 0;
  let roundsCompleted = 0;
  let fireToggle = false;
  const [ax, az] = cfg.map.doors[0]!.anchors[0]!;
  const post = { x: ax - POST_BEFORE_DOOR, z: az };
  game.teleportPlayer(post.x, post.z);

  const maxTicks = Math.round((opts.rounds * (MAX_ROUND_SECONDS + cfg.rounds.breakSeconds)) / SIM_DT);
  try {
    for (let t = 0; t < maxTicks && roundsCompleted < opts.rounds && problems.length === 0; t++) {
      const input = decide(game, fireToggle, post);
      fireToggle = !fireToggle;
      game.step(input);

      for (const ev of game.events) {
        if (ev.type === 'roundEnd') roundsCompleted = ev.round;
        if (ev.type === 'roundStart') roundStartTick = game.tick;
        if (ev.type === 'enemySpawned') {
          const e = game.enemies[ev.enemy]!;
          watch[ev.enemy] = { since: game.tick, x: e.pos.x, z: e.pos.z };
        }
      }

      if (game.player.points < 0) problems.push(`Puntos negativos (${game.player.points}) en la ronda ${game.round.number}`);
      if (game.round.phase === 'active' && (game.tick - roundStartTick) * SIM_DT > MAX_ROUND_SECONDS) {
        problems.push(`La ronda ${game.round.number} no termina tras ${MAX_ROUND_SECONDS} s (vivos: ${game.round.alive}, por salir: ${game.round.toSpawn})`);
      }

      // Enemigos atascados.
      for (const e of game.enemies) {
        if (e.phase === 'inactive') continue;
        const age = (game.tick - e.spawnTick) * SIM_DT;
        if (e.phase !== 'chasing' && age > MAX_SECONDS_TO_ENTER) {
          problems.push(`Enemigo ${e.index} lleva ${Math.round(age)} s sin entrar (estado ${e.phase}, ventana ${e.window})`);
          continue;
        }
        if (e.phase !== 'chasing') continue;
        const w = watch[e.index]!;
        const nearPlayer = Math.hypot(e.pos.x - game.player.pos.x, e.pos.z - game.player.pos.z) <= cfg.enemies.attackRange;
        if (nearPlayer || Math.hypot(e.pos.x - w.x, e.pos.z - w.z) > STUCK_DISTANCE) {
          watch[e.index] = { since: game.tick, x: e.pos.x, z: e.pos.z };
        } else if ((game.tick - w.since) * SIM_DT > STUCK_SECONDS) {
          problems.push(
            `Enemigo ${e.index} atascado en (${e.pos.x.toFixed(1)}, ${e.pos.z.toFixed(1)}) durante ${STUCK_SECONDS} s en la ronda ${game.round.number}`,
          );
        }
      }
    }
    if (roundsCompleted < opts.rounds && problems.length === 0) {
      problems.push(`Solo se completaron ${roundsCompleted} de ${opts.rounds} rondas`);
    }
    return { roundsCompleted, simSeconds: game.tick * SIM_DT, kills: game.round.kills, doorOpened: game.doors[0]!.open, problems };
  } finally {
    game.free();
  }
}

function decide(game: Game, fireToggle: boolean, post: { x: number; z: number }): PlayerInput {
  const input = emptyInput();
  const p = game.player;
  input.yaw = p.yaw;
  input.pitch = p.pitch;

  // Compras: SMG-5 primero, luego la puerta, luego munición cuando falte.
  const buy = game.cfg.map.wallBuys[0]!;
  const door = game.cfg.map.doors[0]!;
  const smg = p.slots.find((s) => s?.weapon === buy.weapon);
  const ammoCost = Math.round(buy.cost * game.cfg.economy.ammoCostFactor);
  if (!smg && p.points >= buy.cost) return useAt(game, buy.anchor, input);
  if (smg && !game.doors[0]!.open && p.points >= door.cost + ammoCost) return useAt(game, door.anchors[0]!, input);
  if (smg && smg.mag + smg.reserve < 30 && p.points >= ammoCost) return useAt(game, buy.anchor, input);
  if (Math.hypot(p.pos.x - post.x, p.pos.z - post.z) > 0.5) game.teleportPlayer(post.x, post.z);

  // Arma: el SMG-5 si tiene balas.
  const smgSlot = p.slots.findIndex((s) => s?.weapon === buy.weapon);
  if (smgSlot >= 0 && p.current !== smgSlot && smg && smg.mag + smg.reserve > 0) input.selectSlot = smgSlot;

  // Apunta a la cabeza del enemigo dentro más cercano.
  let target = -1;
  let best = Infinity;
  for (const e of game.enemies) {
    if (e.phase !== 'chasing') continue;
    const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
    if (d < best) {
      best = d;
      target = e.index;
    }
  }
  if (target < 0) return input;
  const e = game.enemies[target]!;
  const dx = e.pos.x - p.pos.x;
  const dz = e.pos.z - p.pos.z;
  input.yaw = Math.atan2(-dx, -dz);
  input.pitch = Math.atan2(e.pos.y + HEAD_HEIGHT - (p.pos.y + EYE_HEIGHT), Math.hypot(dx, dz));

  const slot = p.slots[p.current];
  const cfgW = slot ? game.cfg.weapons[slot.weapon] : undefined;
  const hasAmmo = slot && slot.mag + slot.reserve > 0;
  if (!hasAmmo || best < 1.2) input.melee = fireToggle;
  else input.fire = cfgW?.fireMode === 'auto' ? true : fireToggle;
  return input;
}

/** Se coloca en un punto de compra y pulsa usar (alternando para que cuente como pulsación nueva). */
function useAt(game: Game, anchor: [number, number], input: PlayerInput): PlayerInput {
  const p = game.player;
  if (Math.hypot(p.pos.x - anchor[0], p.pos.z - anchor[1]) > 0.1) {
    game.teleportPlayer(anchor[0], anchor[1]);
    return input;
  }
  input.use = game.tick % 2 === 0;
  return input;
}
