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
    // Cada enemigo de las 30 rondas ha salido, ha entrado y ha caído.
    let expected = 0;
    for (let r = 1; r <= 30; r++) expected += enemyCount(r);
    expect(report.kills).toBe(expected);
    // También ha abierto la puerta, así que han entrado enemigos por el laboratorio.
    expect(report.doorOpened).toBe(true);
  }, 300_000);
});
