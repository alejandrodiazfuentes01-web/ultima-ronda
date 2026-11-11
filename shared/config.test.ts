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
});
