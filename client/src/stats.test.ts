import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../shared/config';
import { Game } from '../../shared/sim/game';
import { initSim } from '../../shared/sim/libs';
import { emptyInput, type PlayerInput } from '../../shared/sim/types';
import { PlayStats } from './stats';

let game: Game | null = null;
beforeAll(async () => {
  await initSim();
});
afterEach(() => {
  game?.free();
  game = null;
});

function step(g: Game, stats: PlayStats, input: Partial<PlayerInput> = {}): void {
  g.step({ ...emptyInput(), yaw: g.player.yaw, pitch: g.player.pitch, ...input });
  stats.onStep(g);
}

describe('resumen de partida', () => {
  it('cuenta ronda, disparos, aciertos, bajas, puntos ganados y gastados y compras', () => {
    game = new Game(loadConfig(), { invulnerable: true, damageScale: 100 });
    const g = game;
    const stats = new PlayStats();
    step(g, stats); // recoge el inicio de la ronda 1
    g.teleportPlayer(6, 9);
    g.spawnEnemyInside(6, 5);
    step(g, stats);
    step(g, stats, { fire: true, yaw: 0, pitch: 0 }); // a la cabeza
    for (let i = 0; i < 12; i++) step(g, stats); // la M1911 no dispara más de 400 veces por minuto
    step(g, stats, { fire: true, yaw: 0, pitch: 0.6 }); // al techo
    g.player.points = 1000; // subir puntos a mano no cuenta como gasto
    g.teleportPlayer(9.5, 1);
    step(g, stats);
    step(g, stats, { use: true }); // compra el SMG-5

    const s = stats.summary();
    expect(s.roundReached).toBe(1);
    expect(s.shots).toBe(2);
    expect(s.shotsThatHit).toBe(1);
    expect(s.kills).toBe(1);
    expect(s.headshotKills).toBe(1);
    expect(s.earned).toBe(100);
    expect(s.spent).toBe(750);
    expect(s.purchases).toEqual([{ what: 'weapon', id: 'smg5', round: 1, seconds: 0 }]);
  });

  it('apunta qué derribó al jugador y dónde estaba', () => {
    game = new Game(loadConfig(), { autoRounds: false });
    const g = game;
    const stats = new PlayStats();
    g.teleportPlayer(6, 7);
    g.spawnEnemyInside(6, 6.2);
    for (let i = 0; i < 600 && g.player.alive; i++) step(g, stats);
    const s = stats.summary();
    expect(s.hitsTaken).toBe(3);
    expect(s.lastHitFrom).toBe('dentro');
    expect(s.lastZone).toBe('vestibulo');
  });
});
