/** Tipos que comparten la simulación y quien la lee (cliente, jugador automático, servidor). */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Lo que el jugador pide en un paso de simulación. */
export interface PlayerInput {
  /** Movimiento local: x a la derecha, z hacia delante. Entre -1 y 1. */
  moveX: number;
  moveZ: number;
  /** Giro horizontal en radianes. 0 mira hacia -z. */
  yaw: number;
  /** Giro vertical en radianes. Positivo mira hacia arriba. */
  pitch: number;
  sprint: boolean;
  jump: boolean;
  fire: boolean;
  reload: boolean;
  use: boolean;
  melee: boolean;
  /** Ranura de arma pedida (0, 1...) o null. */
  selectSlot: number | null;
  /** -1 o 1 para pasar de arma con la rueda; 0 si no. */
  cycleWeapon: number;
}

export function emptyInput(): PlayerInput {
  return {
    moveX: 0,
    moveZ: 0,
    yaw: 0,
    pitch: 0,
    sprint: false,
    jump: false,
    fire: false,
    reload: false,
    use: false,
    melee: false,
    selectSlot: null,
    cycleWeapon: 0,
  };
}

export type HitPart = 'head' | 'torso' | 'limb';

export type SimEvent =
  | { type: 'shot'; weapon: string }
  | { type: 'dryFire'; weapon: string }
  | { type: 'hit'; enemy: number; part: HitPart; killed: boolean }
  | { type: 'points'; amount: number }
  | { type: 'melee'; hit: boolean }
  | { type: 'reloadStart'; weapon: string }
  | { type: 'purchase'; what: 'weapon' | 'ammo' | 'door'; id: string }
  | { type: 'denied'; cost: number }
  | { type: 'roundStart'; round: number }
  | { type: 'roundEnd'; round: number }
  | { type: 'playerHit'; health: number }
  | { type: 'plankTorn'; window: number }
  | { type: 'plankRepaired'; window: number }
  | { type: 'enemySpawned'; enemy: number }
  | { type: 'enemyEntered'; enemy: number }
  | { type: 'gameOver'; round: number };

export type Prompt =
  | { kind: 'repair' }
  | { kind: 'buyWeapon'; weapon: string; cost: number }
  | { kind: 'buyAmmo'; weapon: string; cost: number }
  | { kind: 'openDoor'; cost: number };

/** Opciones para pruebas y para el jugador automático. El juego normal no las usa. */
export interface SimOptions {
  /** Semilla del azar: misma semilla, misma partida. */
  seed?: number;
  /** El jugador no recibe daño. */
  invulnerable?: boolean;
  /** Multiplica el daño del jugador. Solo para acelerar el jugador automático. */
  damageScale?: number;
  /** false para que no aparezcan enemigos solos (pruebas de reglas sueltas). */
  autoRounds?: boolean;
}
