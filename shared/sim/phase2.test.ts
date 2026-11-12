import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, type GameConfig } from '../config';
import { Game } from './game';
import { initSim } from './libs';
import { emptyInput, type PlayerInput, type SimEvent, type SimOptions } from './types';

const games: Game[] = [];

beforeAll(async () => {
  await initSim();
});
afterEach(() => {
  while (games.length) games.pop()!.free();
});

function newGame(opts: SimOptions = {}, tweak?: (c: GameConfig) => void): Game {
  const cfg = loadConfig();
  tweak?.(cfg);
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

/** Coloca al jugador en un punto de uso y pulsa E. */
function useAt(g: Game, x: number, z: number): SimEvent[] {
  g.teleportPlayer(x, z);
  run(g, 1);
  return run(g, 1, () => ({ use: true }));
}

/** Da un arma en la ranura 1 y la deja en la mano, lista para disparar. */
function equip(g: Game, weapon: string) {
  const w = g.cfg.weapons[weapon]!;
  g.player.slots[1] = { weapon, mag: w.magazine, reserve: w.reserve, upgraded: false };
  g.player.current = 1;
}

const map = () => loadConfig().map;
const station = (perk: string) => map().perkStations.find((s) => s.perk === perk)!.anchor;

describe('armas del Contenedor', () => {
  it('el SVD atraviesa hasta 3 enemigos en fila', () => {
    const g = newGame();
    equip(g, 'svd');
    g.teleportPlayer(6, 9);
    const ids = [6, 5, 4, 3].map((z) => g.spawnEnemyInside(6, z)!.index);
    run(g, 1);
    const ev = run(g, 1, () => ({ fire: true, yaw: 0, pitch: 0 }));
    const hit = new Set(ev.filter((e) => e.type === 'hit').map((e) => (e as { enemy: number }).enemy));
    expect(hit.size).toBe(3);
    expect(hit.has(ids[3]!)).toBe(false); // el cuarto se libra
  });

  it('las demás armas solo alcanzan al primero', () => {
    const g = newGame();
    g.teleportPlayer(6, 9);
    for (const z of [6, 5]) g.spawnEnemyInside(6, z);
    run(g, 1);
    const ev = run(g, 1, () => ({ fire: true, yaw: 0, pitch: 0 }));
    expect(count(ev, 'hit')).toBe(1);
  });

  it('el Arco voltaico salta a 5 enemigos cercanos y no a los lejanos', () => {
    const g = newGame();
    equip(g, 'arco');
    g.teleportPlayer(6, 10);
    g.spawnEnemyInside(6, 6.5);
    for (const [x, z] of [
      [8, 6],
      [4, 6],
      [8, 4],
      [4, 4],
      [6, 3],
    ] as const) {
      g.spawnEnemyInside(x, z);
    }
    const far = g.spawnEnemyInside(1, 1)!;
    run(g, 1);
    const ev = run(g, 1, () => ({ fire: true, yaw: 0, pitch: 0 }));
    const hit = new Set(ev.filter((e) => e.type === 'hit').map((e) => (e as { enemy: number }).enemy));
    expect(hit.size).toBe(5);
    expect(count(ev, 'chain')).toBe(4);
    expect(hit.has(far.index)).toBe(false);
  });
});

describe('energía y sueros', () => {
  it('Coraza necesita energía; con ella, duplica la vida', () => {
    const g = newGame();
    g.player.points = 5000;
    const [cx, cz] = station('coraza');
    g.doors[0]!.open = true;
    g.physics.openDoor(0);
    useAt(g, cx, cz);
    expect(g.prompt).toEqual({ kind: 'needPower' });
    expect(g.player.perks).toEqual([]);

    const [px, pz] = map().powerSwitch.anchor;
    const ev = useAt(g, px, pz);
    expect(ev).toContainEqual({ type: 'powerOn' });
    expect(g.power).toBe(true);

    useAt(g, cx, cz);
    expect(g.player.perks).toEqual(['coraza']);
    expect(g.player.points).toBe(2500);
    expect(g.maxHealth()).toBe(200);
    run(g, seconds(5));
    expect(g.player.health).toBe(200);
  });

  it('sin saldo no se compra un suero', () => {
    const g = newGame();
    g.player.points = 1000;
    const [x, z] = station('segundoAliento');
    const ev = useAt(g, x, z);
    expect(ev).toContainEqual({ type: 'denied', cost: 1500 });
    expect(g.player.perks).toEqual([]);
    expect(g.player.points).toBe(1000);
  });

  it('Segundo aliento funciona sin energía', () => {
    const g = newGame();
    g.player.points = 1500;
    const [x, z] = station('segundoAliento');
    useAt(g, x, z);
    expect(g.player.perks).toEqual(['segundoAliento']);
    expect(g.power).toBe(false);
  });

  it('no se pueden llevar más sueros que el máximo', () => {
    const g = newGame({}, (c) => {
      c.perks.maxPerks = 1;
    });
    g.player.points = 10000;
    g.power = true;
    const [x, z] = station('segundoAliento');
    useAt(g, x, z);
    g.doors[0]!.open = true;
    g.physics.openDoor(0);
    const [cx, cz] = station('coraza');
    useAt(g, cx, cz);
    expect(g.prompt).toEqual({ kind: 'perkFull' });
    expect(g.player.perks).toEqual(['segundoAliento']);
    expect(g.player.points).toBe(10000 - 1500);
  });
});

describe('derribo con Segundo aliento', () => {
  /** Partida con un enemigo pegado al jugador que le golpea cada 1,2 s. */
  function beaten(g: Game): void {
    g.teleportPlayer(6, 7);
    g.spawnEnemyInside(6, 6.2);
  }

  it('al caer con Segundo aliento te levantas solo a los 5 s, sin sueros y con vida completa', () => {
    const g = newGame({ invulnerable: false });
    g.player.perks.push('segundoAliento');
    beaten(g);
    const ev: SimEvent[] = [];
    for (let i = 0; i < seconds(10) && !g.player.downed; i++) ev.push(...run(g, 1));
    expect(g.player.downed).toBe(true);
    expect(ev).toContainEqual({ type: 'downed', revivesLeft: 2 });
    expect(g.player.perks).toEqual([]);
    expect(g.activeSlot()?.weapon).toBe('m1911');
    expect(g.round.phase).not.toBe('over');

    // Caído no recibe daño aunque el enemigo siga pegando.
    const during = run(g, seconds(4.5));
    expect(count(during, 'playerHit')).toBe(0);
    expect(g.player.downed).toBe(true);

    const after = run(g, seconds(0.6));
    expect(after).toContainEqual({ type: 'revived' });
    expect(g.player.downed).toBe(false);
    expect(g.player.health).toBe(100);
  });

  it('sin Segundo aliento, caer termina la partida', () => {
    const g = newGame({ invulnerable: false });
    beaten(g);
    const ev = run(g, seconds(10));
    expect(ev.some((e) => e.type === 'gameOver')).toBe(true);
    expect(ev.some((e) => e.type === 'downed')).toBe(false);
  });

  it('tres veces por partida; después la estación se apaga', () => {
    const g = newGame();
    g.player.selfRevivesUsed = 3;
    expect(g.perkStationOn('segundoAliento')).toBe(false);
    g.player.points = 5000;
    const [x, z] = station('segundoAliento');
    useAt(g, x, z);
    expect(g.prompt).toBeNull();
    expect(g.player.perks).toEqual([]);
  });
});

describe('El Contenedor', () => {
  const spot = (i: number) => map().contenedorSpots[i]!.anchor;

  it('sin saldo no se abre', () => {
    const g = newGame();
    g.player.points = 900;
    const [x, z] = spot(0);
    const ev = useAt(g, x, z);
    expect(ev).toContainEqual({ type: 'denied', cost: 950 });
    expect(g.contenedor.phase).toBe('idle');
  });

  it('cuesta 950, gira 4 s y da un arma que no llevas', () => {
    const g = newGame();
    g.player.points = 2000;
    const [x, z] = spot(0);
    useAt(g, x, z);
    expect(g.player.points).toBe(1050);
    expect(g.contenedor.phase).toBe('spinning');
    const ev = run(g, seconds(4.1));
    const offer = ev.find((e) => e.type === 'contenedorOffer') as { weapon: string } | undefined;
    expect(offer).toBeDefined();
    expect(offer!.weapon).not.toBe('m1911');
    expect(g.prompt).toEqual({ kind: 'takeWeapon', weapon: offer!.weapon });
    run(g, 1, () => ({ use: true }));
    expect(g.player.slots[1]?.weapon).toBe(offer!.weapon);
    expect(g.player.current).toBe(1);
  });

  it('nunca repite un arma que ya llevas', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const g = newGame({ seed });
      equip(g, 'smg5');
      g.player.points = 950;
      const [x, z] = spot(0);
      useAt(g, x, z);
      expect(g.contenedor.weapon).not.toBe('smg5');
      g.free();
      games.pop();
    }
  });

  it('si no la coges en 10 s, el arma se pierde', () => {
    const g = newGame();
    g.player.points = 950;
    const [x, z] = spot(0);
    useAt(g, x, z);
    run(g, seconds(4.1 + 10.1));
    expect(g.contenedor.phase).toBe('idle');
    expect(g.player.slots[1]).toBeNull();
  });

  it('se traslada al otro hueco tras sus usos y tarda 15 s en aparecer', () => {
    const g = newGame();
    expect(g.contenedor.movesAfter).toBeGreaterThanOrEqual(4);
    expect(g.contenedor.movesAfter).toBeLessThanOrEqual(8);
    g.contenedor.movesAfter = 1;
    g.player.points = 950;
    const [x, z] = spot(0);
    useAt(g, x, z);
    run(g, seconds(4.1));
    const ev = run(g, 1, () => ({ use: true }));
    expect(ev).toContainEqual({ type: 'contenedorMoving' });
    expect(g.contenedor.phase).toBe('moving');
    run(g, 1); // el aviso se recalcula al principio de cada paso
    expect(g.prompt).toBeNull();
    run(g, seconds(14.5));
    expect(g.contenedor.phase).toBe('moving');
    const moved = run(g, seconds(1));
    expect(moved).toContainEqual({ type: 'contenedorMoved', spot: 1 });
    expect(g.contenedor.spot).toBe(1);
    expect(g.contenedor.uses).toBe(0);
    const [x2, z2] = spot(1);
    g.teleportPlayer(x2, z2);
    run(g, 1);
    expect(g.prompt).toEqual({ kind: 'buyContenedor', cost: 950 });
  });
});

describe('La Forja', () => {
  const forja = () => map().forja.anchor;

  it('necesita energía', () => {
    const g = newGame();
    g.player.points = 6000;
    const [x, z] = forja();
    useAt(g, x, z);
    expect(g.prompt).toEqual({ kind: 'needPower' });
    expect(g.player.points).toBe(6000);
  });

  it('cuesta 5.000, tarda 5 s y devuelve el arma con el doble de daño y cargador × 1,5', () => {
    const g = newGame();
    g.power = true;
    g.player.points = 6000;
    const [x, z] = forja();
    useAt(g, x, z);
    expect(g.player.points).toBe(1000);
    expect(g.player.slots[0]).toBeNull();
    expect(g.forja.phase).toBe('working');
    const ev = run(g, seconds(5.1));
    expect(ev).toContainEqual({ type: 'forjaReady', weapon: 'm1911' });
    run(g, 1, () => ({ use: true }));
    const slot = g.player.slots[0]!;
    expect(slot.upgraded).toBe(true);
    expect(slot.mag).toBe(12);
    expect(slot.reserve).toBe(96);

    // Doble daño: 40 por bala al cuerpo.
    g.teleportPlayer(6, 9);
    const e = g.spawnEnemyInside(6, 5)!;
    run(g, seconds(0.6));
    const h0 = e.health;
    const eye = g.eye();
    const pitch = Math.atan2(1.15 - eye.y, Math.hypot(e.pos.x - eye.x, e.pos.z - eye.z));
    const yaw = Math.atan2(-(e.pos.x - eye.x), -(e.pos.z - eye.z));
    run(g, 1, () => ({ fire: true, yaw, pitch }));
    expect(h0 - e.health).toBeCloseTo(40);
  });

  it('no se puede mejorar dos veces mientras solo haya un efecto', () => {
    const g = newGame();
    g.power = true;
    g.player.points = 10000;
    g.player.slots[0]!.upgraded = true;
    const [x, z] = forja();
    useAt(g, x, z);
    expect(g.prompt).toBeNull();
    expect(g.player.points).toBe(10000);
  });

  it('las bajas con arma mejorada sueltan una onda de ceniza que daña a los cercanos', () => {
    const g = newGame({ damageScale: 100 });
    g.round.number = 1;
    g.player.slots[0]!.upgraded = true;
    g.teleportPlayer(6, 9);
    const target = g.spawnEnemyInside(6, 5)!;
    const near = g.spawnEnemyInside(7.5, 4.5)!;
    const far = g.spawnEnemyInside(1, 1)!;
    run(g, 1);
    const ev = run(g, 1, () => ({ fire: true, yaw: 0, pitch: 0 }));
    expect(ev.some((e) => e.type === 'ashWave')).toBe(true);
    expect(target.phase).toBe('inactive');
    // Ronda 1: vida 150, la onda quita la mitad (75) y mata con el segundo... aquí con una basta comprobar el daño.
    expect(near.health).toBeLessThan(150);
    expect(far.health).toBe(150);
  });
});

describe('power-ups', () => {
  it('se recogen al pasar por encima', () => {
    const g = newGame();
    g.dropPowerup('puntosDobles', 6, 5);
    g.teleportPlayer(6, 7);
    expect(run(g, 1).some((e) => e.type === 'powerupPickup')).toBe(false);
    g.teleportPlayer(6, 5.5);
    expect(run(g, 1)).toContainEqual({ type: 'powerupPickup', kind: 'puntosDobles' });
    expect(g.effects.puntosDobles).toBeGreaterThan(29);
  });

  it('Puntos dobles: una baja al cuerpo da 120 y dura 30 s', () => {
    const g = newGame({ damageScale: 100 });
    g.effects.puntosDobles = 30;
    g.teleportPlayer(6, 9);
    const e = g.spawnEnemyInside(6, 5)!;
    run(g, 1);
    const before = g.player.points;
    const eye = g.eye();
    run(g, 1, () => ({ fire: true, yaw: 0, pitch: Math.atan2(1.15 - eye.y, Math.hypot(e.pos.x - eye.x, e.pos.z - eye.z)) }));
    expect(g.player.points - before).toBe(120);
    const end = run(g, seconds(30));
    expect(end).toContainEqual({ type: 'effectEnd', kind: 'puntosDobles' });
  });

  it('Baja instantánea: cualquier impacto mata', () => {
    const g = newGame();
    g.round.number = 20;
    g.effects.bajaInstantanea = 30;
    g.teleportPlayer(6, 9);
    const e = g.spawnEnemyInside(6, 5)!;
    expect(e.health).toBe(2710);
    run(g, 1);
    run(g, 1, () => ({ fire: true, yaw: 0, pitch: 0 }));
    expect(e.phase).toBe('inactive');
  });

  it('Onda expansiva: caen todos y da 400 puntos, sin puntos por baja', () => {
    const g = newGame();
    for (const z of [3, 4, 5]) g.spawnEnemyInside(4, z);
    g.spawnEnemy(0);
    expect(g.round.alive).toBe(4);
    g.dropPowerup('ondaExpansiva', 6, 7);
    const before = g.player.points;
    g.teleportPlayer(6, 7);
    run(g, 1);
    expect(g.round.alive).toBe(0);
    expect(g.player.points - before).toBe(400);
  });

  it('Munición completa llena todas las armas', () => {
    const g = newGame();
    equip(g, 'mk17');
    g.player.slots[0]!.mag = 1;
    g.player.slots[0]!.reserve = 0;
    g.player.slots[1]!.mag = 0;
    g.player.slots[1]!.reserve = 3;
    g.dropPowerup('municionCompleta', 6, 7);
    g.teleportPlayer(6, 7);
    run(g, 1);
    expect(g.player.slots[0]).toMatchObject({ mag: 8, reserve: 64 });
    expect(g.player.slots[1]).toMatchObject({ mag: 20, reserve: 120 });
  });

  it('desaparecen a los 30 s si nadie los coge', () => {
    const g = newGame();
    const slot = g.dropPowerup('bajaInstantanea', 2, 2);
    g.teleportPlayer(10, 10);
    run(g, seconds(29.5));
    expect(g.pickups[slot]!.active).toBe(true);
    const ev = run(g, seconds(1));
    expect(ev).toContainEqual({ type: 'powerupExpired', slot });
  });

  it('caen como mucho 4 por ronda', () => {
    const g = newGame({ damageScale: 1000 }, (c) => {
      c.powerups.dropChance = 1;
    });
    g.round.number = 1;
    g.teleportPlayer(6, 11);
    let drops = 0;
    for (let i = 0; i < 6; i++) {
      g.spawnEnemyInside(6, 4);
      run(g, 1);
      drops += count(run(g, 1, () => ({ fire: true, yaw: 0, pitch: -0.05 })), 'powerupDrop');
      run(g, 10);
    }
    expect(g.round.kills).toBe(6);
    expect(drops).toBe(4);
  });
});

describe('herramientas de prueba', () => {
  it('se puede empezar en otra ronda y con otros puntos', () => {
    const g = newGame({ autoRounds: true, startRound: 8, startPoints: 5000 });
    expect(g.round.number).toBe(8);
    expect(g.round.toSpawn).toBe(31);
    expect(g.player.points).toBe(5000);
    const e = g.spawnEnemy(0)!;
    expect(e.health).toBe(850);
    expect(e.speed).toBe(4);
  });
});

describe('la horda', () => {
  it('se agrupa hombro con hombro: menos de 0,8 m de media hasta el vecino más cercano', () => {
    const g = newGame();
    g.round.number = 6;
    g.teleportPlayer(6, 6);
    for (let i = 0; i < 10; i++) g.spawnEnemyInside(2 + (i % 5) * 1.5, 2 + Math.floor(i / 5) * 1.5);
    let sum = 0;
    let n = 0;
    for (let t = 0; t < seconds(12); t++) {
      run(g, 1, () => ({ yaw: 0, moveZ: t > seconds(6) ? -0.4 : 0 }));
      if (t > seconds(5) && t % 30 === 0) {
        const es = g.enemies.filter((e) => e.phase === 'chasing');
        for (const a of es) {
          let best = Infinity;
          for (const b of es) if (a !== b) best = Math.min(best, Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z));
          sum += best;
          n++;
        }
      }
    }
    expect(sum / n).toBeLessThan(0.8);
  });

  it('no se puede pasar entre dos Vacíos que están juntos', () => {
    const g = newGame();
    g.teleportPlayer(6, 8);
    // Dos Vacíos uno junto a otro, cerrando el paso hacia el norte.
    const a = g.spawnEnemyInside(5.62, 6)!;
    const b = g.spawnEnemyInside(6.38, 6)!;
    // Que no se muevan: se les quita el agente de navegación (solo cuenta su cuerpo).
    for (const e of [a, b]) {
      g.nav.removeAgent(e.agent!);
      e.agent = null;
    }
    run(g, seconds(3), () => ({ yaw: 0, moveZ: 1, sprint: true }));
    expect(g.player.pos.z).toBeGreaterThan(6.3);
  });
});

