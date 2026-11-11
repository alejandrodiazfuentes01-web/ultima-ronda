/**
 * Curvas de ronda del GDD («Números y balance»).
 * Los valores viven en shared/data/rounds.json y se validan al cargar.
 */
import rawRounds from './data/rounds.json';

export interface RoundsConfig {
  enemyHealth: {
    linearBase: number;
    linearPerRound: number;
    linearUntilRound: number;
    exponentialBase: number;
    exponentialFactor: number;
  };
  enemyCount: { quadratic: number; linear: number; constant: number };
  spawnInterval: { initialSeconds: number; decayPerRound: number; minSeconds: number };
  aliveCap: { solo: number; perExtraPlayer: number; max: number };
}

function section(raw: unknown, name: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) throw new Error(`rounds.json: falta la sección «${name}»`);
  const value = (raw as Record<string, unknown>)[name];
  if (typeof value !== 'object' || value === null) throw new Error(`rounds.json: falta la sección «${name}»`);
  return value as Record<string, unknown>;
}

function positive(obj: Record<string, unknown>, where: string, key: string): number {
  const value = obj[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`rounds.json: «${where}.${key}» debe ser un número mayor que 0`);
  }
  return value;
}

/** Valida datos de rondas sin confiar en su forma. Lanza un error legible si algo falta o no es válido. */
export function parseRoundsConfig(raw: unknown): RoundsConfig {
  const h = section(raw, 'enemyHealth');
  const c = section(raw, 'enemyCount');
  const s = section(raw, 'spawnInterval');
  const a = section(raw, 'aliveCap');
  return {
    enemyHealth: {
      linearBase: positive(h, 'enemyHealth', 'linearBase'),
      linearPerRound: positive(h, 'enemyHealth', 'linearPerRound'),
      linearUntilRound: positive(h, 'enemyHealth', 'linearUntilRound'),
      exponentialBase: positive(h, 'enemyHealth', 'exponentialBase'),
      exponentialFactor: positive(h, 'enemyHealth', 'exponentialFactor'),
    },
    enemyCount: {
      quadratic: positive(c, 'enemyCount', 'quadratic'),
      linear: positive(c, 'enemyCount', 'linear'),
      constant: positive(c, 'enemyCount', 'constant'),
    },
    spawnInterval: {
      initialSeconds: positive(s, 'spawnInterval', 'initialSeconds'),
      decayPerRound: positive(s, 'spawnInterval', 'decayPerRound'),
      minSeconds: positive(s, 'spawnInterval', 'minSeconds'),
    },
    aliveCap: {
      solo: positive(a, 'aliveCap', 'solo'),
      perExtraPlayer: positive(a, 'aliveCap', 'perExtraPlayer'),
      max: positive(a, 'aliveCap', 'max'),
    },
  };
}

export const ROUNDS: RoundsConfig = parseRoundsConfig(rawRounds);

function checkRound(round: number): void {
  if (!Number.isInteger(round) || round < 1) throw new Error(`Ronda no válida: ${round}`);
}

/** H(r): vida del enemigo en la ronda r. Lineal hasta la última ronda lineal, exponencial después. */
export function enemyHealth(round: number, cfg: RoundsConfig = ROUNDS): number {
  checkRound(round);
  const h = cfg.enemyHealth;
  if (round <= h.linearUntilRound) return h.linearBase + h.linearPerRound * (round - 1);
  return Math.round(h.exponentialBase * h.exponentialFactor ** (round - h.linearUntilRound));
}

/** N(r): enemigos de la ronda r en solitario. */
export function enemyCount(round: number, cfg: RoundsConfig = ROUNDS): number {
  checkRound(round);
  const c = cfg.enemyCount;
  return Math.round(c.quadratic * round ** 2 + c.linear * round + c.constant);
}

/** S(r): segundos entre apariciones en la ronda r, nunca por debajo del mínimo. */
export function spawnInterval(round: number, cfg: RoundsConfig = ROUNDS): number {
  checkRound(round);
  const s = cfg.spawnInterval;
  return Math.max(s.minSeconds, s.initialSeconds * s.decayPerRound ** (round - 1));
}

/** Enemigos vivos a la vez según el número de jugadores, con su tope. */
export function aliveCap(players: number, cfg: RoundsConfig = ROUNDS): number {
  if (!Number.isInteger(players) || players < 1) throw new Error(`Número de jugadores no válido: ${players}`);
  const a = cfg.aliveCap;
  return Math.min(a.max, a.solo + a.perExtraPlayer * (players - 1));
}
