import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { Game } from './game';
import { initSim } from './libs';
import { emptyInput, type PlayerInput, type SimEvent, type SimOptions, type Vec3 } from './types';

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

function run(g: Game, steps: number, input: (i: number) => Partial<PlayerInput> = () => ({})): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < steps; i++) {
    g.step({ ...emptyInput(), yaw: g.player.yaw, pitch: g.player.pitch, ...input(i) });
    all.push(...g.events);
  }
  return all;
}

const seconds = (s: number) => Math.round(s * 60);
const count = (ev: SimEvent[], type: SimEvent['type']) => ev.filter((e) => e.type === type).length;

function equip(g: Game, weapon: string, mag?: number) {
  const w = g.cfg.weapons[weapon]!;
  g.player.slots[1] = { weapon, mag: mag ?? w.magazine, reserve: w.reserve, upgraded: false };
  g.player.current = 1;
}

/** Ángulo en grados entre la mirada y el punto al que fue una bala. */
function offAxis(g: Game, to: Vec3): number {
  const eye = g.eye();
  const look = g.lookDir();
  const d = { x: to.x - eye.x, y: to.y - eye.y, z: to.z - eye.z };
  const len = Math.hypot(d.x, d.y, d.z);
  const cos = (d.x * look.x + d.y * look.y + d.z * look.z) / len;
  return (Math.acos(Math.min(1, cos)) * 180) / Math.PI;
}

describe('apuntar con la mira', () => {
  it('la mira sube en el tiempo del arma y baja más rápido al soltar', () => {
    const g = newGame();
    const w = cfg.weapons.m1911!;
    run(g, seconds(w.aimSeconds / 2), () => ({ aim: true }));
    expect(g.player.aim).toBeGreaterThan(0.4);
    expect(g.player.aim).toBeLessThan(0.6);
    run(g, seconds(w.aimSeconds), () => ({ aim: true }));
    expect(g.player.aim).toBe(1);
    run(g, seconds(w.aimSeconds / cfg.handling.aimExitFactor) + 1);
    expect(g.player.aim).toBe(0);
  });

  it('con la mira subida se anda más despacio y no se puede esprintar', () => {
    const g = newGame();
    run(g, seconds(1), () => ({ aim: true, moveZ: 1, sprint: true, yaw: Math.PI }));
    expect(g.player.sprinting).toBe(false);
    const speed = Math.hypot(g.player.vel.x, g.player.vel.z);
    expect(speed).toBeCloseTo(cfg.player.walkSpeed * cfg.handling.aimMoveFactor, 2);
  });

  it('recargar baja la mira', () => {
    const g = newGame();
    equip(g, 'smg5', 5);
    run(g, seconds(0.5), () => ({ aim: true }));
    expect(g.player.aim).toBe(1);
    run(g, seconds(0.5), (i) => ({ aim: true, reload: i === 0 }));
    expect(g.player.reloadTimer).toBeGreaterThan(0);
    expect(g.player.aim).toBe(0);
  });
});

describe('dispersión', () => {
  it('desde la cadera es mayor que apuntando, y crece al moverse y al disparar seguido', () => {
    const g = newGame();
    equip(g, 'ak74');
    const w = cfg.weapons.ak74!;
    run(g, 2);
    expect(g.spreadDegrees()).toBeCloseTo(w.hipSpread, 5);
    run(g, seconds(0.6), () => ({ moveZ: 1, yaw: Math.PI }));
    // El AK-74 pesa: anda al 95 %, y la dispersión por moverse va con la velocidad real.
    expect(g.spreadDegrees()).toBeCloseTo(w.hipSpread + cfg.handling.moveSpread * w.mobility, 2);
    run(g, seconds(1));
    run(g, seconds(0.5), () => ({ fire: true, yaw: Math.PI }));
    expect(g.spreadDegrees()).toBeGreaterThan(w.hipSpread * 1.5);
    run(g, seconds(1), () => ({ aim: true }));
    expect(g.spreadDegrees()).toBeCloseTo(w.aimSpread, 5);
  });

  it('cada bala cae dentro del cono, y apuntando el cono casi se cierra', () => {
    const g = newGame();
    equip(g, 'smg5');
    const w = cfg.weapons.smg5!;
    const max = w.hipSpread * (1 + cfg.handling.bloomMax) + 0.01;
    const hip = run(g, seconds(1.5), () => ({ fire: true })).filter((e) => e.type === 'tracer') as Array<{ to: Vec3 }>;
    expect(hip.length).toBeGreaterThan(10);
    const hipAngles = hip.map((t) => offAxis(g, t.to));
    expect(Math.max(...hipAngles)).toBeLessThanOrEqual(max);
    expect(Math.max(...hipAngles)).toBeGreaterThan(w.aimSpread * 2);

    equip(g, 'smg5');
    run(g, seconds(1), () => ({ aim: true }));
    const aimed = run(g, seconds(1), () => ({ aim: true, fire: true })).filter((e) => e.type === 'tracer') as Array<{ to: Vec3 }>;
    expect(aimed.length).toBeGreaterThan(5);
    expect(Math.max(...aimed.map((t) => offAxis(g, t.to)))).toBeLessThanOrEqual(w.aimSpread + 0.01);
  });

  it('misma semilla, mismos disparos', () => {
    const shots = (seed: number) => {
      const g = newGame({ seed });
      equip(g, 'smg5');
      return JSON.stringify(run(g, seconds(1), () => ({ fire: true })).filter((e) => e.type === 'tracer'));
    };
    expect(shots(7)).toBe(shots(7));
    expect(shots(7)).not.toBe(shots(8));
  });
});

describe('fusil de ráfagas M16', () => {
  it('una pulsación suelta tres disparos y hay que volver a pulsar', () => {
    const g = newGame();
    equip(g, 'm16');
    let ev = run(g, seconds(1), (i) => ({ fire: i === 0 }));
    expect(count(ev, 'shot')).toBe(3);
    expect(g.player.slots[1]!.mag).toBe(27);
    // Mantener pulsado no dispara más: hace falta otra pulsación.
    ev = run(g, seconds(1), () => ({ fire: true }));
    expect(count(ev, 'shot')).toBe(3);
  });

  it('la ráfaga se corta si se acaba el cargador', () => {
    const g = newGame();
    equip(g, 'm16', 2);
    const ev = run(g, seconds(0.4), (i) => ({ fire: i === 0 }));
    expect(count(ev, 'shot')).toBe(2);
    expect(g.player.burstLeft).toBe(0);
  });
});

describe('escopeta M870', () => {
  it('cada disparo suelta ocho perdigones abiertos', () => {
    const g = newGame();
    equip(g, 'm870');
    const ev = run(g, 2, (i) => ({ fire: i === 0 }));
    expect(count(ev, 'shot')).toBe(1);
    const tracers = ev.filter((e) => e.type === 'tracer') as Array<{ to: Vec3 }>;
    expect(tracers.length).toBe(8);
    const angles = tracers.map((t) => offAxis(g, t.to));
    expect(Math.max(...angles)).toBeGreaterThan(0.5);
    expect(Math.max(...angles)).toBeLessThanOrEqual(cfg.weapons.m870!.hipSpread * (1 + cfg.handling.bloomMax) + cfg.weapons.m870!.pelletSpread);
  });

  it('a bocajarro todos los perdigones dan al mismo Vacío', () => {
    const g = newGame();
    equip(g, 'm870');
    g.teleportPlayer(6, 9);
    const e = g.spawnEnemyInside(6, 7.6)!;
    e.health = 100000;
    run(g, 1);
    const eye = g.eye();
    const pitch = Math.atan2(1.15 - eye.y, Math.hypot(e.pos.x - eye.x, e.pos.z - eye.z));
    const ev = run(g, 2, (i) => ({ fire: i === 0, yaw: 0, pitch }));
    expect(count(ev, 'hit')).toBe(8);
  });

  it('se recarga cartucho a cartucho y disparar corta la recarga', () => {
    const g = newGame();
    equip(g, 'm870', 2);
    const w = cfg.weapons.m870!;
    let ev = run(g, seconds(w.reloadSeconds) + 2, (i) => ({ reload: i === 0 }));
    expect(count(ev, 'shellLoaded')).toBe(1);
    expect(g.player.slots[1]!.mag).toBe(3);
    expect(g.player.reloadTimer).toBeGreaterThan(0);
    // Dispara a mitad de recarga: sale el tiro y la recarga se para.
    ev = run(g, 3, (i) => ({ fire: i === 0 }));
    expect(count(ev, 'shot')).toBe(1);
    expect(g.player.reloadTimer).toBe(0);
    expect(g.player.slots[1]!.mag).toBe(2);
    // Sin tocar nada más, la recarga completa llena el cargador y avisa del último cartucho.
    ev = run(g, seconds(w.reloadSeconds * 5 + 1), (i) => ({ reload: i === 0 }));
    expect(g.player.slots[1]!.mag).toBe(w.magazine);
    expect(ev.filter((e) => e.type === 'shellLoaded' && e.last).length).toBe(1);
    expect(g.player.slots[1]!.reserve).toBe(w.reserve - 5);
  });
});

describe('arsenal del GDD', () => {
  it('las cuatro armas nuevas llevan los valores de la tabla', () => {
    const w = cfg.weapons;
    expect(w.m870).toMatchObject({ damage: 30, pellets: 8, rpm: 70, magazine: 6, mobility: 0.95, recoil: 'high' });
    expect(w.v45).toMatchObject({ damage: 24, rpm: 1200, magazine: 30, mobility: 1, recoil: 'high', fireMode: 'auto' });
    expect(w.ak74).toMatchObject({ damage: 45, rpm: 650, magazine: 30, mobility: 0.95, recoil: 'medium', fireMode: 'auto' });
    expect(w.m16).toMatchObject({ damage: 60, fireMode: 'burst', burstCount: 3, magazine: 30, mobility: 0.95, recoil: 'low' });
  });

  it('la M870 se compra en el Vestíbulo por 500 y la V-45 en el Laboratorio por 1.000', () => {
    const buy = (id: string) => cfg.map.wallBuys.find((b) => b.weapon === id);
    expect(buy('m870')).toMatchObject({ cost: 500 });
    expect(buy('m870')!.anchor[0]).toBeLessThan(cfg.map.labArea[0]);
    expect(buy('v45')).toMatchObject({ cost: 1000 });
    expect(buy('v45')!.anchor[0]).toBeGreaterThan(cfg.map.labArea[0]);
  });

  it('toda arma que se puede conseguir existe y tiene su mira', () => {
    for (const id of [...cfg.contenedor.pool, ...cfg.map.wallBuys.map((b) => b.weapon), cfg.player.startWeapon]) {
      expect(cfg.weapons[id], id).toBeDefined();
      expect(cfg.weapons[id]!.aimZoom, id).toBeLessThanOrEqual(1);
    }
  });
});
