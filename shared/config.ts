/**
 * Todos los datos de balance y del mapa, validados al cargar (regla 3).
 * Ningún número de balance se escribe en el código: sale de aquí.
 */
import rawEconomy from './data/economy.json';
import rawEnemies from './data/enemies.json';
import rawMap from './data/maps/prototipo.json';
import rawPlayer from './data/player.json';
import rawWeapons from './data/weapons.json';
import { DataError, arr, bool, num, nums, obj, str, type Obj } from './data/validate';
import { ROUNDS, type RoundsConfig } from './rounds';

// ---------- Jugador ----------

export interface PlayerConfig {
  maxHealth: number;
  regenDelaySeconds: number;
  regenPerSecond: number;
  walkSpeed: number;
  sprintSpeed: number;
  jumpHeight: number;
  startPoints: number;
  headMultiplier: number;
  limbMultiplier: number;
  useRange: number;
  repairSecondsPerPlank: number;
  weaponSwitchSeconds: number;
  startWeapon: string;
  weaponSlots: number;
  melee: { damage: number; range: number; cooldownSeconds: number };
}

export function parsePlayer(raw: unknown): PlayerConfig {
  const w = 'player.json';
  const o = obj(raw, w);
  const m = obj(o.melee, `${w}.melee`);
  return {
    maxHealth: num(o, 'maxHealth', w),
    regenDelaySeconds: num(o, 'regenDelaySeconds', w, { allowZero: true }),
    regenPerSecond: num(o, 'regenPerSecond', w),
    walkSpeed: num(o, 'walkSpeed', w),
    sprintSpeed: num(o, 'sprintSpeed', w),
    jumpHeight: num(o, 'jumpHeight', w),
    startPoints: num(o, 'startPoints', w, { int: true, allowZero: true }),
    headMultiplier: num(o, 'headMultiplier', w),
    limbMultiplier: num(o, 'limbMultiplier', w),
    useRange: num(o, 'useRange', w),
    repairSecondsPerPlank: num(o, 'repairSecondsPerPlank', w),
    weaponSwitchSeconds: num(o, 'weaponSwitchSeconds', w, { allowZero: true }),
    startWeapon: str(o, 'startWeapon', w),
    weaponSlots: num(o, 'weaponSlots', w, { int: true, min: 1 }),
    melee: {
      damage: num(m, 'damage', `${w}.melee`),
      range: num(m, 'range', `${w}.melee`),
      cooldownSeconds: num(m, 'cooldownSeconds', `${w}.melee`),
    },
  };
}

// ---------- Economía ----------

export interface EconomyConfig {
  hit: number;
  killBody: number;
  killHead: number;
  killMelee: number;
  repairPlank: number;
  repairCapPerRound: number;
  ammoCostFactor: number;
}

export function parseEconomy(raw: unknown): EconomyConfig {
  const w = 'economy.json';
  const o = obj(raw, w);
  const int = { int: true, allowZero: true };
  return {
    hit: num(o, 'hit', w, int),
    killBody: num(o, 'killBody', w, int),
    killHead: num(o, 'killHead', w, int),
    killMelee: num(o, 'killMelee', w, int),
    repairPlank: num(o, 'repairPlank', w, int),
    repairCapPerRound: num(o, 'repairCapPerRound', w, int),
    ammoCostFactor: num(o, 'ammoCostFactor', w, { max: 1 }),
  };
}

// ---------- Enemigos ----------

export interface EnemiesConfig {
  hitDamage: number;
  attackIntervalSeconds: number;
  attackRange: number;
  plankTearSeconds: number;
  climbSeconds: number;
  speedTiers: Array<{ fromRound: number; speed: number }>;
}

export function parseEnemies(raw: unknown): EnemiesConfig {
  const w = 'enemies.json';
  const o = obj(raw, w);
  const tiers = arr(o, 'speedTiers', w).map((t, i) => {
    const to = obj(t, `${w}.speedTiers[${i}]`);
    return {
      fromRound: num(to, 'fromRound', `${w}.speedTiers[${i}]`, { int: true, min: 1 }),
      speed: num(to, 'speed', `${w}.speedTiers[${i}]`),
    };
  });
  if (tiers[0]?.fromRound !== 1) throw new DataError(`${w}.speedTiers: el primer tramo debe empezar en la ronda 1`);
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i]!.fromRound <= tiers[i - 1]!.fromRound) throw new DataError(`${w}.speedTiers: las rondas deben ir en orden`);
  }
  return {
    hitDamage: num(o, 'hitDamage', w),
    attackIntervalSeconds: num(o, 'attackIntervalSeconds', w),
    attackRange: num(o, 'attackRange', w),
    plankTearSeconds: num(o, 'plankTearSeconds', w),
    climbSeconds: num(o, 'climbSeconds', w),
    speedTiers: tiers,
  };
}

// ---------- Armas ----------

export const FIRE_MODES = ['semi', 'auto'] as const;
export const RECOIL_LEVELS = ['none', 'low', 'medium', 'high', 'veryHigh'] as const;

export interface WeaponConfig {
  id: string;
  damage: number;
  pellets: number;
  fireMode: (typeof FIRE_MODES)[number];
  rpm: number;
  magazine: number;
  reserve: number;
  reloadSeconds: number;
  mobility: number;
  recoil: (typeof RECOIL_LEVELS)[number];
}

export function parseWeapons(raw: unknown): Record<string, WeaponConfig> {
  const w = 'weapons.json';
  const o = obj(raw, w);
  const out: Record<string, WeaponConfig> = {};
  for (const [id, value] of Object.entries(o)) {
    const ww = `${w}.${id}`;
    const x = obj(value, ww);
    out[id] = {
      id,
      damage: num(x, 'damage', ww),
      pellets: num(x, 'pellets', ww, { int: true, min: 1 }),
      fireMode: str(x, 'fireMode', ww, FIRE_MODES) as WeaponConfig['fireMode'],
      rpm: num(x, 'rpm', ww),
      magazine: num(x, 'magazine', ww, { int: true, min: 1 }),
      reserve: num(x, 'reserve', ww, { int: true, allowZero: true }),
      reloadSeconds: num(x, 'reloadSeconds', ww),
      mobility: num(x, 'mobility', ww, { max: 1.5 }),
      recoil: str(x, 'recoil', ww, RECOIL_LEVELS) as WeaponConfig['recoil'],
    };
  }
  return out;
}

// ---------- Mapa ----------

/** Caja alineada con los ejes: [minX, minY, minZ, maxX, maxY, maxZ]. */
export type Box = [number, number, number, number, number, number];
/** Punto en el suelo: [x, z]. */
export type Point2 = [number, number];

export interface WindowDef {
  id: string;
  zone: string;
  /** Hueco en planta: [minX, minZ, maxX, maxZ]. */
  opening: [number, number, number, number];
  inside: Point2;
  outside: Point2;
  spawn: Point2;
}

export interface MapConfig {
  name: string;
  wallHeight: number;
  sillHeight: number;
  windowTop: number;
  planksPerWindow: number;
  floor: Box;
  walls: Box[];
  windows: WindowDef[];
  doors: Array<{ id: string; cost: number; box: Box; anchors: Point2[]; opensZone: string }>;
  wallBuys: Array<{ id: string; weapon: string; cost: number; anchor: Point2; facing: Point2 }>;
  zones: Array<{ id: string; startsOpen: boolean }>;
  playerStart: { position: [number, number, number]; yaw: number };
  navFloors: Array<[number, number, number, number]>;
}

function boxOf(raw: unknown, where: string): Box {
  const b = nums(raw, 6, where);
  if (b[0]! >= b[3]! || b[1]! >= b[4]! || b[2]! >= b[5]!) throw new DataError(`${where}: caja con tamaño nulo o invertido`);
  return b as Box;
}

export function parseMap(raw: unknown, weapons: Record<string, WeaponConfig>): MapConfig {
  const w = 'mapa';
  const o = obj(raw, w);
  const zones = arr(o, 'zones', w).map((z, i) => {
    const zo = obj(z, `${w}.zones[${i}]`);
    return { id: str(zo, 'id', `${w}.zones[${i}]`), startsOpen: bool(zo, 'startsOpen', `${w}.zones[${i}]`) };
  });
  const zoneIds = zones.map((z) => z.id);
  if (!zones.some((z) => z.startsOpen)) throw new DataError(`${w}.zones: al menos una zona debe empezar abierta`);

  const windows = arr(o, 'windows', w).map((x, i): WindowDef => {
    const ww = `${w}.windows[${i}]`;
    const wo = obj(x, ww);
    return {
      id: str(wo, 'id', ww),
      zone: str(wo, 'zone', ww, zoneIds),
      opening: nums(wo.opening, 4, `${ww}.opening`) as WindowDef['opening'],
      inside: nums(wo.inside, 2, `${ww}.inside`) as Point2,
      outside: nums(wo.outside, 2, `${ww}.outside`) as Point2,
      spawn: nums(wo.spawn, 2, `${ww}.spawn`) as Point2,
    };
  });

  const doors = arr(o, 'doors', w).map((x, i) => {
    const dw = `${w}.doors[${i}]`;
    const d = obj(x, dw);
    return {
      id: str(d, 'id', dw),
      cost: num(d, 'cost', dw, { int: true }),
      box: boxOf(d.box, `${dw}.box`),
      anchors: arr(d, 'anchors', dw).map((a, j) => nums(a, 2, `${dw}.anchors[${j}]`) as Point2),
      opensZone: str(d, 'opensZone', dw, zoneIds),
    };
  });

  const wallBuys = arr(o, 'wallBuys', w).map((x, i) => {
    const bw = `${w}.wallBuys[${i}]`;
    const b = obj(x, bw);
    return {
      id: str(b, 'id', bw),
      weapon: str(b, 'weapon', bw, Object.keys(weapons)),
      cost: num(b, 'cost', bw, { int: true }),
      anchor: nums(b.anchor, 2, `${bw}.anchor`) as Point2,
      facing: nums(b.facing, 2, `${bw}.facing`) as Point2,
    };
  });

  const ps = obj(o.playerStart, `${w}.playerStart`);
  return {
    name: str(o, 'name', w),
    wallHeight: num(o, 'wallHeight', w),
    sillHeight: num(o, 'sillHeight', w),
    windowTop: num(o, 'windowTop', w),
    planksPerWindow: num(o, 'planksPerWindow', w, { int: true, min: 1 }),
    floor: boxOf(o.floor, `${w}.floor`),
    walls: arr(o, 'walls', w).map((b, i) => boxOf(b, `${w}.walls[${i}]`)),
    windows,
    doors,
    wallBuys,
    zones,
    playerStart: {
      position: nums(ps.position, 3, `${w}.playerStart.position`) as [number, number, number],
      yaw: num(ps, 'yaw', `${w}.playerStart`, { min: -Math.PI * 2, max: Math.PI * 2 }),
    },
    navFloors: arr(o, 'navFloors', w).map((r, i) => nums(r, 4, `${w}.navFloors[${i}]`) as [number, number, number, number]),
  };
}

// ---------- Todo junto ----------

export interface GameConfig {
  rounds: RoundsConfig;
  player: PlayerConfig;
  economy: EconomyConfig;
  enemies: EnemiesConfig;
  weapons: Record<string, WeaponConfig>;
  map: MapConfig;
}

export function loadConfig(): GameConfig {
  const weapons = parseWeapons(rawWeapons);
  const player = parsePlayer(rawPlayer);
  if (!weapons[player.startWeapon]) throw new DataError(`player.json.startWeapon: el arma «${player.startWeapon}» no existe`);
  return {
    rounds: ROUNDS,
    player,
    economy: parseEconomy(rawEconomy),
    enemies: parseEnemies(rawEnemies),
    weapons,
    map: parseMap(rawMap, weapons),
  };
}

/** Velocidad del enemigo en una ronda, según los tramos de enemies.json. */
export function enemySpeed(round: number, cfg: EnemiesConfig): number {
  let speed = cfg.speedTiers[0]!.speed;
  for (const t of cfg.speedTiers) if (round >= t.fromRound) speed = t.speed;
  return speed;
}

export type { Obj };
