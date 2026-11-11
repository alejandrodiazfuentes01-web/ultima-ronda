import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { Game } from './game';
import { initSim } from './libs';
import { emptyInput, type PlayerInput, type SimEvent, type SimOptions } from './types';

const cfg = loadConfig();
const games: Game[] = [];

beforeAll(async () => {
  await initSim();
});
afterEach(() => {
  while (games.length) games.pop()!.free();
});

function newGame(opts: SimOptions = {}): Game {
  const g = new Game(cfg, { autoRounds: false, invulnerable: true, ...opts });
  games.push(g);
  return g;
}

/** Avanza `steps` pasos con la entrada que devuelva `input` y junta todos los eventos. */
function run(g: Game, steps: number, input: (i: number) => Partial<PlayerInput> = () => ({})): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < steps; i++) {
    g.step({ ...emptyInput(), yaw: g.player.yaw, pitch: g.player.pitch, ...input(i) });
    all.push(...g.events);
  }
  return all;
}

const seconds = (s: number) => Math.round(s * 60);

/** Un enemigo esperando en la ventana norte del vestíbulo, que el jugador ve desde su posición inicial. */
function enemyAtNorthWindow(g: Game) {
  const e = g.spawnEnemy(0)!;
  run(g, seconds(10), () => ({}));
  expect(e.phase).toBe('tearing');
  return e;
}

/** Inclinación vertical para apuntar desde el ojo del jugador a una altura del enemigo. */
function pitchTo(g: Game, e: { pos: { x: number; z: number } }, height: number) {
  const eye = g.eye();
  return Math.atan2(height - eye.y, Math.hypot(e.pos.x - eye.x, e.pos.z - eye.z));
}

describe('inicio de partida', () => {
  it('500 puntos, M1911 con 8 + 64 balas y vida completa', () => {
    const g = newGame();
    expect(g.player.points).toBe(500);
    expect(g.player.slots[0]).toEqual({ weapon: 'm1911', mag: 8, reserve: 64 });
    expect(g.player.slots[1]).toBeNull();
    expect(g.player.health).toBe(100);
  });

  it('el aviso de que empieza la ronda 1 llega a quien lee el primer paso', () => {
    const g = newGame({ autoRounds: true });
    const ev = run(g, 1);
    expect(ev).toContainEqual({ type: 'roundStart', round: 1 });
    expect(run(g, 1)).not.toContainEqual({ type: 'roundStart', round: 1 });
  });

  it('la ronda 1 trae 8 enemigos, uno cada 2 segundos', () => {
    const g = newGame({ autoRounds: true });
    expect(g.round.number).toBe(1);
    expect(g.round.toSpawn).toBe(8);
    const ev = run(g, seconds(5));
    expect(ev.filter((e) => e.type === 'enemySpawned').length).toBe(3); // a los 0, 2 y 4 s
  });
});

describe('puntos por tipo de impacto', () => {
  it('impacto que no mata: +10', () => {
    const g = newGame();
    const e = enemyAtNorthWindow(g);
    const before = g.player.points;
    const ev = run(g, 1, () => ({ fire: true, pitch: pitchTo(g, e, 1.15) }));
    expect(ev).toContainEqual({ type: 'hit', enemy: e.index, part: 'torso', killed: false });
    expect(g.player.points - before).toBe(10);
  });

  it('baja al cuerpo: +60', () => {
    const g = newGame({ damageScale: 100 });
    const e = enemyAtNorthWindow(g);
    const before = g.player.points;
    run(g, 1, () => ({ fire: true, pitch: pitchTo(g, e, 1.15) }));
    expect(e.phase).toBe('inactive');
    expect(g.player.points - before).toBe(60);
  });

  it('baja a la cabeza: +100', () => {
    const g = newGame({ damageScale: 100 });
    const e = enemyAtNorthWindow(g);
    const before = g.player.points;
    const ev = run(g, 1, () => ({ fire: true, pitch: pitchTo(g, e, 1.6) }));
    expect(ev).toContainEqual({ type: 'hit', enemy: e.index, part: 'head', killed: true });
    expect(g.player.points - before).toBe(100);
  });

  it('la cabeza hace 2,5 veces el daño', () => {
    const g = newGame();
    const e = enemyAtNorthWindow(g);
    const h0 = e.health;
    run(g, 1, () => ({ fire: true, pitch: pitchTo(g, e, 1.6) }));
    expect(h0 - e.health).toBeCloseTo(20 * 2.5);
  });

  it('baja cuerpo a cuerpo: +130', () => {
    const g = newGame({ damageScale: 100 });
    const e = enemyAtNorthWindow(g);
    g.teleportPlayer(6, 0.6);
    const before = g.player.points;
    const ev = run(g, 1, () => ({ melee: true }));
    expect(ev).toContainEqual({ type: 'melee', hit: true });
    expect(e.phase).toBe('inactive');
    expect(g.player.points - before).toBe(130);
  });

  it('el cuerpo a cuerpo no alcanza a más de 1,8 m', () => {
    const g = newGame({ damageScale: 100 });
    enemyAtNorthWindow(g);
    g.teleportPlayer(6, 3);
    const ev = run(g, 1, () => ({ melee: true }));
    expect(ev).toContainEqual({ type: 'melee', hit: false });
  });

  it('los muros paran las balas', () => {
    const g = newGame({ damageScale: 100 });
    const e = g.spawnEnemy(1)!; // ventana oeste: el jugador mira al norte, detrás hay muro
    run(g, seconds(10));
    g.teleportPlayer(6, 2);
    const yaw = Math.atan2(-(e.pos.x - 6), -(e.pos.z - 2)) + 0.25; // apunta al muro, junto a la ventana
    const ev = run(g, 1, () => ({ fire: true, yaw, pitch: pitchTo(g, e, 1.15) }));
    expect(ev.some((x) => x.type === 'hit')).toBe(false);
  });
});

describe('armas', () => {
  it('la M1911 dispara una vez por pulsación aunque se mantenga el gatillo', () => {
    const g = newGame();
    const ev = run(g, seconds(1), () => ({ fire: true }));
    expect(ev.filter((e) => e.type === 'shot').length).toBe(1);
    expect(g.player.slots[0]!.mag).toBe(7);
  });

  it('al vaciar el cargador y apretar, recarga en 1,6 s y pasa balas de la reserva', () => {
    const g = newGame();
    for (let i = 0; i < 8; i++) run(g, 10, (k) => ({ fire: k === 0 }));
    expect(g.player.slots[0]!.mag).toBe(0);
    const ev = run(g, 1, () => ({ fire: true }));
    expect(ev).toContainEqual({ type: 'reloadStart', weapon: 'm1911' });
    run(g, seconds(1.5));
    expect(g.player.slots[0]!.mag).toBe(0);
    run(g, seconds(0.2));
    expect(g.player.slots[0]).toEqual({ weapon: 'm1911', mag: 8, reserve: 56 });
  });

  it('sin balas ni reserva, el gatillo solo hace clic', () => {
    const g = newGame();
    g.player.slots[0] = { weapon: 'm1911', mag: 0, reserve: 0 };
    const ev = run(g, 1, () => ({ fire: true }));
    expect(ev).toContainEqual({ type: 'dryFire', weapon: 'm1911' });
  });
});

describe('compras', () => {
  it('sin saldo suficiente no se compra el arma y los puntos no cambian', () => {
    const g = newGame();
    g.teleportPlayer(9.5, 1);
    expect(g.prompt).toBeNull();
    run(g, 1);
    expect(g.prompt).toEqual({ kind: 'buyWeapon', weapon: 'smg5', cost: 750 });
    const ev = run(g, 1, () => ({ use: true }));
    expect(ev).toContainEqual({ type: 'denied', cost: 750 });
    expect(g.player.points).toBe(500);
    expect(g.player.slots[1]).toBeNull();
  });

  it('con saldo se compra el SMG-5; recomprar munición cuesta la mitad', () => {
    const g = newGame();
    g.player.points = 2000;
    g.teleportPlayer(9.5, 1);
    run(g, 1, () => ({ use: true }));
    expect(g.player.points).toBe(1250);
    expect(g.player.slots[1]).toEqual({ weapon: 'smg5', mag: 30, reserve: 150 });
    expect(g.player.current).toBe(1);

    // Con la munición llena no se cobra nada.
    run(g, 1);
    run(g, 1, () => ({ use: true }));
    expect(g.player.points).toBe(1250);
    expect(g.prompt).toEqual({ kind: 'buyAmmo', weapon: 'smg5', cost: 375 });

    // Dispara un poco y recompra.
    run(g, seconds(1.5), () => ({ fire: true }));
    expect(g.player.slots[1]!.mag).toBeLessThan(30);
    run(g, 1);
    run(g, 1, () => ({ use: true }));
    expect(g.player.points).toBe(875);
    expect(g.player.slots[1]).toEqual({ weapon: 'smg5', mag: 30, reserve: 150 });
  });

  it('el SMG-5 es automático: unas 13 balas por segundo con el gatillo apretado', () => {
    const g = newGame();
    g.player.points = 750;
    g.teleportPlayer(9.5, 1);
    run(g, 1, () => ({ use: true }));
    run(g, seconds(1)); // termina de sacar el arma
    const ev = run(g, seconds(1), () => ({ fire: true }));
    const shots = ev.filter((e) => e.type === 'shot').length;
    expect(shots).toBeGreaterThanOrEqual(13);
    expect(shots).toBeLessThanOrEqual(14);
  });

  it('se cambia de arma con 1 y 2', () => {
    const g = newGame();
    g.player.points = 750;
    g.teleportPlayer(9.5, 1);
    run(g, 1, () => ({ use: true }));
    run(g, 1, () => ({ selectSlot: 0 }));
    expect(g.player.current).toBe(0);
    run(g, 1, () => ({ cycleWeapon: 1 }));
    expect(g.player.current).toBe(1);
  });

  it('la puerta cerrada no deja pasar; pagada se abre y activa las ventanas del laboratorio', () => {
    const g = newGame();
    const labWindows = () => g.windows.filter((w, i) => cfg.map.windows[i]!.zone === 'laboratorio' && w.active).length;
    expect(labWindows()).toBe(0);

    // Caminar hacia la puerta cerrada: no se cruza.
    g.teleportPlayer(10, 6);
    run(g, seconds(1.5), () => ({ yaw: -Math.PI / 2, moveZ: 1 }));
    expect(g.player.pos.x).toBeLessThan(11.8);

    // Sin saldo: denegado.
    const denied = run(g, 1, () => ({ use: true, yaw: -Math.PI / 2 }));
    expect(denied).toContainEqual({ type: 'denied', cost: 750 });

    g.player.points = 1000;
    run(g, 1, () => ({ yaw: -Math.PI / 2 }));
    run(g, 1, () => ({ use: true, yaw: -Math.PI / 2 }));
    expect(g.player.points).toBe(250);
    expect(g.doors[0]!.open).toBe(true);
    expect(labWindows()).toBe(2);

    run(g, seconds(1), () => ({ yaw: -Math.PI / 2, moveZ: 1 }));
    expect(g.player.pos.x).toBeGreaterThan(12.5);
  });
});

describe('barricadas', () => {
  it('el enemigo arranca una plancha cada 1,5 s y entra cuando no queda ninguna', () => {
    const g = newGame();
    const e = g.spawnEnemy(0)!;
    const ev = run(g, seconds(20));
    expect(ev.filter((x) => x.type === 'plankTorn').length).toBe(5);
    expect(g.windows[0]!.planks).toBe(0);
    expect(ev).toContainEqual({ type: 'enemyEntered', enemy: e.index });
    expect(e.phase).toBe('chasing');
  });

  it('reparar repone una plancha por segundo y da 10 puntos, con tope por ronda', () => {
    const g = newGame();
    g.windows[0]!.planks = 0;
    g.teleportPlayer(6, 1);
    run(g, 1);
    expect(g.prompt).toEqual({ kind: 'repair' });
    const before = g.player.points;
    run(g, seconds(2.05), () => ({ use: true }));
    expect(g.windows[0]!.planks).toBe(2);
    expect(g.player.points - before).toBe(20);

    g.round.repairPoints = 495;
    run(g, seconds(1.05), () => ({ use: true }));
    expect(g.windows[0]!.planks).toBe(3);
    expect(g.player.points - before).toBe(20); // tope alcanzado: sin puntos
  });

  it('soltar la tecla reinicia la reparación', () => {
    const g = newGame();
    g.windows[0]!.planks = 0;
    g.teleportPlayer(6, 1);
    run(g, seconds(0.8), () => ({ use: true }));
    run(g, 1);
    run(g, seconds(0.8), () => ({ use: true }));
    expect(g.windows[0]!.planks).toBe(0);
  });
});

describe('vida del jugador', () => {
  it('cada golpe quita 45 y el tercero termina la partida', () => {
    const g = newGame({ invulnerable: false });
    g.spawnEnemy(0);
    const ev: SimEvent[] = [];
    for (let i = 0; i < seconds(60) && g.round.phase !== 'over'; i++) ev.push(...run(g, 1));
    const hits = ev.filter((x) => x.type === 'playerHit');
    expect(hits.map((h) => (h as { health: number }).health)).toEqual([55, 10, 0]);
    expect(ev).toContainEqual({ type: 'gameOver', round: 0 });
    expect(g.player.alive).toBe(false);
  });

  it('la vida se regenera tras 4 s sin daño', () => {
    const g = newGame();
    g.player.health = 10;
    g.player.sinceDamage = 0;
    run(g, seconds(3.9));
    expect(g.player.health).toBe(10);
    run(g, seconds(1.1));
    expect(g.player.health).toBeGreaterThan(50);
    run(g, seconds(2));
    expect(g.player.health).toBe(100);
  });
});

describe('movimiento', () => {
  it('anda a 4,5 m/s y esprinta a 6,5 m/s', () => {
    const g = newGame();
    g.teleportPlayer(2, 6);
    run(g, seconds(1), () => ({ yaw: -Math.PI / 2, moveZ: 1 }));
    expect(g.player.pos.x - 2).toBeCloseTo(4.5, 0);
    g.teleportPlayer(1, 3);
    run(g, seconds(1), () => ({ yaw: -Math.PI / 2, moveZ: 1, sprint: true }));
    expect(g.player.pos.x - 1).toBeCloseTo(6.5, 0);
  });

  it('las ventanas no dejan salir al jugador', () => {
    const g = newGame();
    g.teleportPlayer(6, 2);
    run(g, seconds(2), () => ({ moveZ: 1 }));
    expect(g.player.pos.z).toBeGreaterThan(0.2);
    run(g, seconds(2), (i) => ({ moveZ: 1, jump: i % 30 === 0 }));
    expect(g.player.pos.z).toBeGreaterThan(0.2);
  });
});
