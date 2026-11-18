import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { jauriaCount, loadConfig } from '../config';
import { enemyHealth } from '../rounds';
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
  const g = new Game(cfg, { autoRounds: false, invulnerable: true, noSpread: true, ...opts });
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
const station = (perk: string) => cfg.map.perkStations.find((s) => s.perk === perk)!.anchor;

function useAt(g: Game, [x, z]: [number, number]): SimEvent[] {
  g.teleportPlayer(x, z);
  run(g, 1);
  return run(g, 1, () => ({ use: true }));
}

function equip(g: Game, weapon: string, mag?: number) {
  const w = g.cfg.weapons[weapon]!;
  g.player.slots[1] = { weapon, mag: mag ?? w.magazine, reserve: w.reserve, upgraded: false };
  g.player.current = 1;
}

describe('La Jauría', () => {
  it('la primera ronda especial es la 5 y las siguientes llegan cada 5 a 7 rondas', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const g = newGame({ seed });
      const specials: number[] = [];
      for (let r = 1; r <= 40; r++) {
        g.startRound(r);
        if (g.round.special) specials.push(r);
      }
      expect(specials[0]).toBe(5);
      for (let i = 1; i < specials.length; i++) {
        const gap = specials[i]! - specials[i - 1]!;
        expect(gap).toBeGreaterThanOrEqual(cfg.jauria.intervalMin);
        expect(gap).toBeLessThanOrEqual(cfg.jauria.intervalMax);
      }
      g.free();
      games.pop();
    }
  });

  it('el aviso de la ronda dice si es especial', () => {
    const g = newGame();
    g.startRound(4);
    expect(g.events).toContainEqual({ type: 'roundStart', round: 4, special: false });
    g.startRound(5);
    expect(g.events).toContainEqual({ type: 'roundStart', round: 5, special: true });
  });

  it('empezar más tarde (herramienta de prueba) no se salta las rondas especiales', () => {
    const g = newGame({ startRound: 8, autoRounds: true });
    expect(g.round.special).toBe(false);
    expect(g.nextSpecial).toBeGreaterThan(8);
    expect(g.nextSpecial).toBeLessThanOrEqual(5 + cfg.jauria.intervalMax * 2);
  });

  it('salen menos enemigos, más rápidos y más frágiles que en una ronda normal', () => {
    const g = newGame();
    g.startRound(5);
    expect(g.round.toSpawn).toBe(jauriaCount(5, cfg.jauria));
    const e = g.spawnEnemy(0)!;
    expect(e.kind).toBe('jauria');
    expect(e.health).toBeCloseTo(enemyHealth(5) * cfg.jauria.healthFraction);
    expect(e.speed).toBeGreaterThan(cfg.jauria.speed * (1 - cfg.jauria.speedVariation) - 1e-9);
    expect(e.speed).toBeLessThanOrEqual(cfg.jauria.speed);
    // Siempre algo más lentos que el esprint del jugador.
    expect(cfg.jauria.speed).toBeLessThan(cfg.player.sprintSpeed);
  });

  it('saltan la ventana sin arrancar planchas', () => {
    const g = newGame();
    g.startRound(5);
    const e = g.spawnEnemy(0)!;
    const ev = run(g, seconds(3));
    expect(ev.filter((x) => x.type === 'plankTorn').length).toBe(0);
    expect(g.windows[0]!.planks).toBe(cfg.map.planksPerWindow);
    expect(e.phase).toBe('chasing');
  });

  it('muerden más a menudo pero quitan menos', () => {
    const g = newGame({ invulnerable: false });
    g.startRound(5);
    g.teleportPlayer(6, 6);
    const e = g.spawnEnemyInside(6, 5.4)!;
    expect(e.kind).toBe('jauria');
    const ev = run(g, seconds(1.3));
    const hits = ev.filter((x) => x.type === 'playerHit');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]).toMatchObject({ health: cfg.player.maxHealth - cfg.jauria.hitDamage });
  });

  it('las balas les dan en la cabeza, que va baja y por delante', () => {
    const g = newGame();
    g.startRound(5);
    g.teleportPlayer(6, 9);
    const e = g.spawnEnemyInside(6, 5)!;
    e.health = 1e6;
    run(g, 1);
    // De frente al jugador, la cabeza queda a ~0,6 m por delante del centro, a 0,78 m del suelo.
    e.yaw = Math.PI;
    run(g, 1);
    const eye = g.eye();
    const headZ = e.pos.z + 0.58;
    const pitch = Math.atan2(0.78 - eye.y, headZ - eye.z === 0 ? 1 : Math.abs(headZ - eye.z));
    const ev = run(g, 1, () => ({ fire: true, yaw: 0, pitch }));
    expect(ev.find((x) => x.type === 'hit')).toMatchObject({ part: 'head' });
  });

  it('no sueltan power-ups al azar, pero el último deja munición completa', () => {
    const g = newGame({ damageScale: 1000 });
    g.startRound(5);
    g.round.toSpawn = 0;
    g.teleportPlayer(6, 9);
    const a = g.spawnEnemyInside(5, 5)!;
    const b = g.spawnEnemyInside(7, 5)!;
    run(g, 1);
    g.cfg.powerups.dropChance = 1;
    const eye = g.eye();
    const aim = (e: typeof a) => ({
      fire: true,
      yaw: Math.atan2(-(e.pos.x - eye.x), -(e.pos.z - eye.z)),
      pitch: Math.atan2(0.62 - eye.y, Math.hypot(e.pos.x - eye.x, e.pos.z - eye.z)),
    });
    let ev = run(g, 1, () => aim(a));
    expect(a.phase).toBe('inactive');
    expect(ev.filter((x) => x.type === 'powerupDrop').length).toBe(0);
    run(g, seconds(0.5));
    ev = run(g, 1, () => aim(b));
    expect(b.phase).toBe('inactive');
    expect(ev).toContainEqual(expect.objectContaining({ type: 'powerupDrop', kind: 'municionCompleta' }));
    g.cfg.powerups.dropChance = loadConfig().powerups.dropChance;
  });

  it('al acabar, la ronda siguiente vuelve a ser normal', () => {
    const g = newGame({ autoRounds: true, startRound: 5, damageScale: 1000 });
    expect(g.round.special).toBe(true);
    g.round.toSpawn = 0;
    run(g, seconds(cfg.rounds.breakSeconds + 1));
    expect(g.round.number).toBe(6);
    expect(g.round.special).toBe(false);
    // Los que salen ahora vuelven a ser Vacíos.
    const spawned = g.enemies.filter((e) => e.phase !== 'inactive');
    expect(spawned.length).toBeGreaterThan(0);
    expect(spawned.every((e) => e.kind === 'vacio')).toBe(true);
  });
});

describe('sueros Pulso y Doble filo', () => {
  it('cuestan lo del GDD y necesitan energía', () => {
    expect(cfg.perks.perks.pulso).toMatchObject({ cost: 3000, needsPower: true, reloadMultiplier: 0.5 });
    expect(cfg.perks.perks.dobleFilo).toMatchObject({ cost: 2000, needsPower: true });
    expect(cfg.perks.perks.dobleFilo!.fireRateMultiplier).toBeGreaterThan(1);
    const g = newGame({ startPoints: 10000 });
    const ev = useAt(g, station('pulso'));
    expect(g.prompt).toEqual({ kind: 'needPower' });
    expect(ev.some((x) => x.type === 'purchase')).toBe(false);
  });

  it('con energía se compran, y no se puede pasar de cuatro sueros', () => {
    const g = newGame({ startPoints: 20000 });
    g.power = true;
    for (const perk of ['segundoAliento', 'coraza', 'pulso', 'dobleFilo']) useAt(g, station(perk));
    expect(g.player.perks).toEqual(['segundoAliento', 'coraza', 'pulso', 'dobleFilo']);
    expect(g.player.points).toBe(20000 - 1500 - 2500 - 3000 - 2000);
  });

  it('Pulso recarga en la mitad de tiempo', () => {
    const g = newGame();
    equip(g, 'smg5', 1);
    run(g, 2, (i) => ({ reload: i === 0 }));
    const normal = g.player.reloadTimer;
    expect(normal).toBeCloseTo(cfg.weapons.smg5!.reloadSeconds - 1 / 60, 2);
    run(g, seconds(3));
    g.player.perks.push('pulso');
    equip(g, 'smg5', 1);
    run(g, 2, (i) => ({ reload: i === 0 }));
    expect(g.player.reloadTimer).toBeCloseTo(cfg.weapons.smg5!.reloadSeconds / 2 - 1 / 60, 2);
  });

  it('Pulso también acelera cada cartucho de la escopeta', () => {
    const g = newGame();
    g.player.perks.push('pulso');
    equip(g, 'm870', 2);
    const ev = run(g, seconds(cfg.weapons.m870!.reloadSeconds * 2 * 0.5) + 2, (i) => ({ reload: i === 0 }));
    expect(ev.filter((x) => x.type === 'shellLoaded').length).toBe(2);
  });

  it('Doble filo dispara más rápido', () => {
    const shots = (perks: string[]) => {
      const g = newGame();
      g.player.perks.push(...perks);
      equip(g, 'smg5');
      return run(g, seconds(1), () => ({ fire: true })).filter((x) => x.type === 'shot').length;
    };
    const normal = shots([]);
    const fast = shots(['dobleFilo']);
    expect(normal).toBeGreaterThanOrEqual(13);
    expect(fast / normal).toBeGreaterThan(1.25);
  });

  it('al caer se pierden también los sueros nuevos', () => {
    const g = newGame({ invulnerable: false });
    g.player.perks.push('segundoAliento', 'pulso', 'dobleFilo');
    g.teleportPlayer(6, 6);
    g.spawnEnemyInside(6, 5.4);
    run(g, seconds(5));
    expect(g.player.downed || g.player.selfRevivesUsed > 0).toBe(true);
    expect(g.player.perks).not.toContain('pulso');
    expect(g.player.perks).not.toContain('dobleFilo');
  });

  it('las cuatro estaciones están en el mapa, y ninguna en la zona de inicio salvo Segundo aliento', () => {
    for (const perk of ['segundoAliento', 'coraza', 'pulso', 'dobleFilo']) expect(station(perk), perk).toBeDefined();
    for (const st of cfg.map.perkStations) {
      if (st.perk === 'segundoAliento') continue;
      expect(st.anchor[0], st.perk).toBeGreaterThan(cfg.map.labArea[0]);
    }
  });
});
