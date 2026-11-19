import { describe, expect, it } from 'vitest';
import rawPlayer from './data/player.json';
import rawWeapons from './data/weapons.json';
import rawMap from './data/maps/prototipo.json';
import { enemySpeed, loadConfig, parseMap, parsePlayer, parseWeapons, zoneAt } from './config';

const cfg = loadConfig();

describe('datos de balance', () => {
  it('cargan y se validan sin errores', () => {
    expect(cfg.player.maxHealth).toBe(100);
    expect(cfg.weapons.m1911?.magazine).toBe(8);
    expect(cfg.weapons.smg5?.rpm).toBe(800);
  });

  it('valores del GDD: vida, golpe, velocidades, cabeza, economía', () => {
    expect(cfg.player.walkSpeed).toBe(4.5);
    expect(cfg.player.sprintSpeed).toBe(6.5);
    expect(cfg.player.headMultiplier).toBe(2.5);
    expect(cfg.player.regenDelaySeconds).toBe(4);
    expect(cfg.enemies.hitDamage).toBe(45);
    expect(cfg.economy).toMatchObject({ hit: 10, killBody: 60, killHead: 100, killMelee: 130, repairPlank: 10 });
    expect(cfg.rounds.breakSeconds).toBe(10);
  });

  it('tres golpes derriban al jugador', () => {
    const hits = Math.ceil(cfg.player.maxHealth / cfg.enemies.hitDamage);
    expect(hits).toBe(3);
  });

  it('velocidad del enemigo: anda hasta la 3, corre desde la 4, esprinta desde la 12', () => {
    expect(enemySpeed(1, cfg.enemies)).toBe(1.5);
    expect(enemySpeed(3, cfg.enemies)).toBe(1.5);
    expect(enemySpeed(4, cfg.enemies)).toBe(4);
    expect(enemySpeed(11, cfg.enemies)).toBe(4);
    expect(enemySpeed(12, cfg.enemies)).toBe(6);
    expect(enemySpeed(40, cfg.enemies)).toBeLessThan(cfg.player.sprintSpeed);
  });

  it('el mapa: vestíbulo con 4 ventanas, laboratorio con 3, puerta de 750 y SMG-5 de 750', () => {
    const byZone = (z: string) => cfg.map.windows.filter((w) => w.zone === z).length;
    expect(byZone('vestibulo')).toBe(4);
    expect(byZone('laboratorio')).toBe(3);
    expect(cfg.map.doors[0]?.cost).toBe(750);
    expect(cfg.map.wallBuys[0]).toMatchObject({ weapon: 'smg5', cost: 750 });
  });

  it('rechaza datos rotos con un mensaje que dice dónde', () => {
    expect(() => parsePlayer({ ...rawPlayer, walkSpeed: -1 })).toThrow(/walkSpeed/);
    expect(() => parseWeapons({ ...rawWeapons, m1911: { ...rawWeapons.m1911, fireMode: 'laser' } })).toThrow(/fireMode/);
    const weapons = parseWeapons(rawWeapons);
    const badBuy = { ...rawMap, wallBuys: [{ ...rawMap.wallBuys[0], weapon: 'no-existe' }] };
    expect(() => parseMap(badBuy, weapons)).toThrow(/weapon/);
  });

  it('fase 2: armas del Contenedor con los valores del GDD', () => {
    const w = cfg.weapons;
    expect(w.mk17).toMatchObject({ damage: 70, rpm: 550, magazine: 20, mobility: 0.9 });
    expect(w.m249).toMatchObject({ damage: 50, rpm: 800, magazine: 100, mobility: 0.85 });
    expect(w.svd).toMatchObject({ damage: 300, fireMode: 'semi', magazine: 10, mobility: 0.9, penetration: 3 });
    expect(w.arco).toMatchObject({ rpm: 90, magazine: 12, mobility: 0.95, recoil: 'none', chain: { targets: 5, range: 4 } });
    expect(w.m1911?.penetration).toBe(1);
    expect(w.m1911?.chain).toBeNull();
  });

  it('fase 2: precios del GDD para sueros, Contenedor, Forja y power-ups', () => {
    expect(cfg.perks.perks.coraza?.cost).toBe(2500);
    expect(cfg.perks.perks.segundoAliento?.cost).toBe(1500);
    expect(cfg.perks.maxPerks).toBe(4);
    expect(cfg.perks.bleedOutSeconds).toBe(45);
    expect(cfg.contenedor.cost).toBe(950);
    expect(cfg.forja).toMatchObject({ cost: 5000, repeatCost: 2500 });
    expect(cfg.powerups).toMatchObject({ effectSeconds: 30, kinds: ['municionCompleta', 'bajaInstantanea', 'puntosDobles', 'ondaExpansiva'] });
  });

  it('cada compra en su zona, como en el GDD', () => {
    const zone = (p: [number, number]) => zoneAt(cfg.map, p[0], p[1])?.id;
    const station = (perk: string) => cfg.map.perkStations.find((p) => p.perk === perk)!.anchor;
    const buy = (weapon: string) => cfg.map.wallBuys.find((b) => b.weapon === weapon)!.anchor;
    expect(zone(station('segundoAliento'))).toBe('vestibulo');
    expect(zone(station('coraza'))).toBe('laboratorio');
    expect(zone(station('pulso'))).toBe('patio');
    expect(zone(station('dobleFilo'))).toBe('energia');
    expect(zone(cfg.map.powerSwitch.anchor)).toBe('energia');
    expect(zone(cfg.map.forja.anchor)).toBe('torre');
    expect(zone(buy('m870'))).toBe('vestibulo');
    expect(zone(buy('smg5'))).toBe('vestibulo');
    expect(zone(buy('v45'))).toBe('laboratorio');
    expect(zone(buy('ak74'))).toBe('almacen');
    expect(zone(buy('m16'))).toBe('patio');
    // El Contenedor: empieza en el Almacén; un hueco por zona que no es la de inicio ni la de energía.
    expect(cfg.map.contenedorSpots.map((s) => zone(s.anchor))).toEqual(['almacen', 'laboratorio', 'patio', 'torre']);
  });

  it('el mapa de la Estación Aurora: seis zonas, siete compuertas que suman 7.500 y energía a 1.750', () => {
    const m = cfg.map;
    expect(m.zones.map((z) => z.id).sort()).toEqual(['almacen', 'energia', 'laboratorio', 'patio', 'torre', 'vestibulo']);
    expect(m.doors.length).toBe(7);
    expect(m.doors.reduce((a, d) => a + d.cost, 0)).toBe(7500);
    // Camino más barato del Vestíbulo a la Sala de energía.
    const cost = new Map<string, number>([['vestibulo', 0]]);
    for (let k = 0; k < 6; k++) {
      for (const d of m.doors) {
        const [a, b] = d.connects;
        for (const [from, to] of [[a, b], [b, a]] as const) {
          const c = cost.get(from);
          if (c !== undefined && (cost.get(to) ?? Infinity) > c + d.cost) cost.set(to, c + d.cost);
        }
      }
    }
    expect(cost.get('energia')).toBe(1750);
    // Cada zona tiene de dos a cuatro entradas de enemigos.
    for (const z of m.zones) {
      const n = m.windows.filter((w) => w.zone === z.id).length;
      expect(n, z.id).toBeGreaterThanOrEqual(2);
      expect(n, z.id).toBeLessThanOrEqual(4);
    }
    // Al aire libre: el Patio y la Torre de radio, que asoma por encima de todo.
    expect(m.zones.filter((z) => !z.roofed).map((z) => z.id)).toEqual(['patio', 'torre']);
  });
});
