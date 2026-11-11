import { describe, expect, it } from 'vitest';
import rawRounds from './data/rounds.json';
import { aliveCap, enemyCount, enemyHealth, parseRoundsConfig, spawnInterval } from './rounds';

// Tabla de «Números y balance» del GDD: [ronda, vida, enemigos, intervalo]
const GDD_TABLE: Array<[number, number, number, number]> = [
  [1, 150, 8, 2.0],
  [5, 550, 20, 1.63],
  [10, 1045, 39, 1.26],
  [15, 1683, 62, 0.98],
  [20, 2710, 90, 0.75],
  [30, 7030, 159, 0.45],
];

describe('curvas de ronda', () => {
  it.each(GDD_TABLE)('ronda %i coincide con la tabla del GDD', (round, health, count, interval) => {
    expect(enemyHealth(round)).toBe(health);
    expect(enemyCount(round)).toBe(count);
    expect(spawnInterval(round)).toBeCloseTo(interval, 2);
  });

  it('la vida es continua entre la parte lineal y la exponencial', () => {
    expect(enemyHealth(9)).toBe(950);
    expect(enemyHealth(10)).toBeGreaterThan(enemyHealth(9));
  });

  it('la vida y el número de enemigos nunca bajan de una ronda a la siguiente', () => {
    for (let r = 1; r < 100; r++) {
      expect(enemyHealth(r + 1)).toBeGreaterThanOrEqual(enemyHealth(r));
      expect(enemyCount(r + 1)).toBeGreaterThanOrEqual(enemyCount(r));
    }
  });

  it('el intervalo de aparición nunca baja de 0,1 s', () => {
    expect(spawnInterval(200)).toBe(0.1);
  });

  it('rechaza rondas que no existen', () => {
    expect(() => enemyHealth(0)).toThrow();
    expect(() => enemyCount(1.5)).toThrow();
  });
});

describe('enemigos vivos a la vez', () => {
  it('24 en solitario, 4 más por jugador y tope de 32', () => {
    expect(aliveCap(1)).toBe(24);
    expect(aliveCap(2)).toBe(28);
    expect(aliveCap(3)).toBe(32);
    expect(aliveCap(4)).toBe(32);
  });
});

describe('validación de rounds.json', () => {
  it('acepta el archivo del repositorio', () => {
    expect(() => parseRoundsConfig(rawRounds)).not.toThrow();
  });

  it('rechaza un valor que falta o no es un número', () => {
    const broken = structuredClone(rawRounds) as unknown as Record<string, Record<string, unknown>>;
    delete broken.enemyCount!.linear;
    expect(() => parseRoundsConfig(broken)).toThrow(/enemyCount\.linear/);
    expect(() => parseRoundsConfig({ ...rawRounds, spawnInterval: { ...rawRounds.spawnInterval, minSeconds: 'x' } })).toThrow();
    expect(() => parseRoundsConfig(null)).toThrow();
  });
});
