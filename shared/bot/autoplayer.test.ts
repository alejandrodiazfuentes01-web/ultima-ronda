import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { initSim } from '../sim/libs';
import { enemyCount } from '../rounds';
import { runBot } from './autoplayer';

beforeAll(async () => {
  await initSim();
});

describe('jugador automático', () => {
  it('juega 30 rondas sin enemigos atascados, rondas sin fin ni puntos negativos', () => {
    const report = runBot(loadConfig(), { rounds: 30 });
    console.log(
      `Jugador automático: ${report.roundsCompleted} rondas, ${report.kills} bajas, ` +
        `${Math.round(report.simSeconds / 60)} min de partida simulada`,
    );
    expect(report.problems).toEqual([]);
    expect(report.roundsCompleted).toBe(30);
    // Cada enemigo de las 30 rondas ha salido, ha entrado y ha caído, también los de La Jauría.
    expect(report.kills).toBe(report.spawned);
    expect(report.spawned).toBeGreaterThan(enemyCount(30));
    // En 30 rondas, La Jauría sale entre 4 y 6 veces (la primera en la 5, luego cada 5 a 7).
    expect(report.specialRounds).toBeGreaterThanOrEqual(4);
    expect(report.specialRounds).toBeLessThanOrEqual(6);
    // También ha abierto la puerta, así que han entrado enemigos por el laboratorio.
    expect(report.doorOpened).toBe(true);
  }, 300_000);

  it('el mapa de prueba amplio también se juega 20 rondas sin atascos', () => {
    const report = runBot(loadConfig('amplio'), { rounds: 20 });
    expect(report.problems).toEqual([]);
    expect(report.roundsCompleted).toBe(20);
    expect(report.doorOpened).toBe(true);
  }, 300_000);
});
