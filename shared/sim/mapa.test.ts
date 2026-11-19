import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, zoneAt } from '../config';
import { Game } from './game';
import { initSim } from './libs';
import { emptyInput, type PlayerInput, type SimOptions } from './types';

const cfg = loadConfig();
const games: Game[] = [];

beforeAll(async () => {
  await initSim();
});
afterEach(() => {
  while (games.length) games.pop()!.free();
});

function newGame(opts: SimOptions = {}): Game {
  const g = new Game(cfg, { autoRounds: false, invulnerable: true, noSpread: true, ...opts });
  games.push(g);
  return g;
}

function run(g: Game, steps: number, input: () => Partial<PlayerInput> = () => ({})): void {
  for (let i = 0; i < steps; i++) g.step({ ...emptyInput(), yaw: g.player.yaw, pitch: g.player.pitch, ...input() });
}

const seconds = (s: number) => Math.round(s * 60);
const doorIndex = (a: string, b: string) => cfg.map.doors.findIndex((d) => d.connects.includes(a) && d.connects.includes(b));

function open(g: Game, i: number): void {
  const d = cfg.map.doors[i]!;
  g.player.points += d.cost;
  g.teleportPlayer(d.anchors[0]![0], d.anchors[0]![1]);
  run(g, 1);
  run(g, 1, () => ({ use: true }));
  run(g, 1);
  expect(g.doors[i]!.open).toBe(true);
}

describe('la Estación Aurora', () => {
  it('abrir una compuerta abre la zona del otro lado y sus ventanas', () => {
    const g = newGame();
    const almacenWindows = () => cfg.map.windows.map((w, i) => [w.zone, g.windows[i]!.active] as const).filter(([z]) => z === 'almacen');
    expect(almacenWindows().every(([, a]) => !a)).toBe(true);
    open(g, doorIndex('vestibulo', 'almacen'));
    expect(almacenWindows().every(([, a]) => a)).toBe(true);
    // Desde el Almacén se puede abrir el Patio, aunque el Laboratorio siga cerrado.
    open(g, doorIndex('almacen', 'patio'));
    const patio = cfg.map.windows.findIndex((w) => w.zone === 'patio');
    expect(g.windows[patio]!.active).toBe(true);
    const lab = cfg.map.windows.findIndex((w) => w.zone === 'laboratorio');
    expect(g.windows[lab]!.active).toBe(false);
  });

  it('una compuerta cerrada no deja pasar a los Vacíos; abierta, sí', () => {
    const g = newGame();
    g.teleportPlayer(6, 7); // Vestíbulo
    const e = g.spawnEnemyInside(9.5, 18)!; // Almacén, detrás de la compuerta 2 cerrada
    run(g, seconds(12));
    expect(zoneAt(cfg.map, e.pos.x, e.pos.z)?.id).toBe('almacen');
    open(g, doorIndex('vestibulo', 'almacen'));
    g.teleportPlayer(6, 7);
    run(g, seconds(15));
    expect(zoneAt(cfg.map, e.pos.x, e.pos.z)?.id).toBe('vestibulo');
    expect(Math.hypot(e.pos.x - g.player.pos.x, e.pos.z - g.player.pos.z)).toBeLessThan(2);
  });

  it('los Vacíos no atajan por una zona cerrada: dan la vuelta por las abiertas', () => {
    const g = newGame();
    // Abiertos Vestíbulo, Almacén y Patio; el Laboratorio sigue cerrado.
    open(g, doorIndex('vestibulo', 'almacen'));
    open(g, doorIndex('almacen', 'patio'));
    g.teleportPlayer(9, 4); // Vestíbulo, junto a la compuerta del Laboratorio
    const e = g.spawnEnemyInside(21, 22)!; // Patio, lejos
    const visited = new Set<string>();
    for (let i = 0; i < seconds(30); i++) {
      run(g, 1);
      const z = zoneAt(cfg.map, e.pos.x, e.pos.z)?.id;
      if (z) visited.add(z);
    }
    expect(visited.has('laboratorio')).toBe(false);
    expect(visited.has('almacen')).toBe(true);
    expect(zoneAt(cfg.map, e.pos.x, e.pos.z)?.id).toBe('vestibulo');
  });
});
