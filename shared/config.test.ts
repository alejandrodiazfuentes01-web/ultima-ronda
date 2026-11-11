import { describe, expect, it } from 'vitest';
import rawPlayer from './data/player.json';
import rawWeapons from './data/weapons.json';
import rawMap from './data/maps/prototipo.json';
import { enemySpeed, loadConfig, parseMap, parsePlayer, parseWeapons } from './config';

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

  it('el mapa del prototipo: vestíbulo con 4 ventanas, laboratorio con 2, puerta de 750 y SMG-5 de 750', () => {
    const byZone = (z: string) => cfg.map.windows.filter((w) => w.zone === z).length;
    expect(byZone('vestibulo')).toBe(4);
    expect(byZone('laboratorio')).toBe(2);
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

  it('fase 2: Segundo aliento en el Vestíbulo, Coraza y El Contenedor en el Laboratorio', () => {
    const inVestibulo = (x: number) => x < 12;
    const station = (perk: string) => cfg.map.perkStations.find((p) => p.perk === perk)!;
    expect(inVestibulo(station('segundoAliento').anchor[0])).toBe(true);
    expect(inVestibulo(station('coraza').anchor[0])).toBe(false);
    for (const spot of cfg.map.contenedorSpots) expect(inVestibulo(spot.anchor[0])).toBe(false);
    expect(inVestibulo(cfg.map.forja.anchor[0])).toBe(false);
    expect(inVestibulo(cfg.map.powerSwitch.anchor[0])).toBe(false);
  });
});
