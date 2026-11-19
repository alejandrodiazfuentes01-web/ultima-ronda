/**
 * Mundo físico (Rapier): muros, ventanas, puertas, el jugador y las cápsulas
 * de impacto de los enemigos. Los disparos son rayos instantáneos.
 */
import { towerLegs, type Box, type Fixture, type MapConfig } from '../config';
import { RAPIER } from './libs';
import type { HitPart, Vec3 } from './types';

type World = InstanceType<typeof RAPIER.World>;
type Collider = InstanceType<typeof RAPIER.Collider>;
type RigidBody = InstanceType<typeof RAPIER.RigidBody>;

// Grupos de colisión: quién choca con quién.
const WORLD = 1 << 0;
const PLAYER = 1 << 1;
const ENEMY = 1 << 2;
const RAY = 1 << 3;
const WINDOW_BLOCK = 1 << 4;

function groups(membership: number, filter: number): number {
  return (membership << 16) | filter;
}

const G_WORLD = groups(WORLD, PLAYER | RAY);
const G_WINDOW_BLOCK = groups(WINDOW_BLOCK, PLAYER); // frena al jugador, no a las balas
const G_PLAYER = groups(PLAYER, WORLD | WINDOW_BLOCK);
const G_ENEMY = groups(ENEMY, RAY);
const G_RAY = groups(RAY, WORLD | ENEMY);

/** Medidas del jugador (geometría, no balance). */
export const PLAYER_RADIUS = 0.35;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.65;
/** Margen que el controlador de personaje deja con el suelo y las paredes. La cápsula se coloca ya con él. */
const KCC_OFFSET = 0.02;
/** Grosor de la losa de una rampa. */
const RAMP_THICKNESS = 0.3;
/** Altura del centro de la cápsula sobre los pies. */
const CAPSULE_CENTER = PLAYER_HEIGHT / 2 + KCC_OFFSET;

export type EnemyKind = 'vacio' | 'jauria';

/**
 * Partes de impacto de cada tipo de enemigo: centro (con el enemigo mirando a -z),
 * forma y tamaño. Una cápsula tumbada va a lo largo del cuerpo (z).
 */
const ENEMY_PARTS: Record<EnemyKind, Array<{ part: HitPart; at: [number, number, number]; halfHeight: number; radius: number; lying?: boolean }>> = {
  vacio: [
    { part: 'head', at: [0, 1.6, 0], halfHeight: 0, radius: 0.16 },
    { part: 'torso', at: [0, 1.15, 0], halfHeight: 0.22, radius: 0.26 },
    { part: 'limb', at: [0, 0.45, 0], halfHeight: 0.25, radius: 0.22 },
  ],
  jauria: [
    { part: 'head', at: [0, 0.78, -0.58], halfHeight: 0, radius: 0.17 },
    { part: 'torso', at: [0, 0.62, 0], halfHeight: 0.32, radius: 0.21, lying: true },
    { part: 'limb', at: [0, 0.25, 0], halfHeight: 0.38, radius: 0.18, lying: true },
  ],
};
const LYING = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };

/** Objetos sólidos del mapa con los que se interactúa: interruptor, estaciones, Forja, huecos del Contenedor. */
export function fixtures(map: MapConfig): Fixture[] {
  return [map.powerSwitch, ...map.perkStations, map.forja, ...map.contenedorSpots];
}

/** Todas las cajas sólidas que no son muros: objetos de uso y decorado. */
export function solidBoxes(map: MapConfig): Box[] {
  return [...fixtures(map).map((f) => f.box), ...map.decor.map((d) => d.box), ...towerLegs(map)];
}

function cuboid(world: World, b: Box, g: number): Collider {
  const desc = RAPIER.ColliderDesc.cuboid((b[3] - b[0]) / 2, (b[4] - b[1]) / 2, (b[5] - b[2]) / 2)
    .setTranslation((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2)
    .setCollisionGroups(g);
  return world.createCollider(desc);
}

export interface RayHit {
  distance: number;
  /** Índice del enemigo o -1 si es el escenario. */
  enemy: number;
  part: HitPart | null;
}

/** Resultado de un disparo: enemigos atravesados y, si la bala acaba en el escenario, dónde. */
export interface PierceResult {
  hits: RayHit[];
  wall: { distance: number; normal: Vec3 } | null;
}

export class Physics {
  readonly world: World;
  private readonly controller;
  private readonly playerBody: RigidBody;
  private readonly playerCollider: Collider;
  private readonly doorColliders: Collider[] = [];
  private readonly enemyBodies: RigidBody[] = [];
  /** Colisionadores de cada enemigo, por tipo: solo los de su tipo están encendidos. */
  private readonly enemyColliders: Array<Record<EnemyKind, Collider[]>> = [];
  private readonly enemyKinds: EnemyKind[] = [];
  /** Asocia cada colisionador de enemigo con su enemigo y su parte. */
  private readonly enemyParts = new Map<number, { enemy: number; part: HitPart }>();
  private grounded = false;

  constructor(map: MapConfig, enemyPool: number, playerStart: Vec3) {
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.world.timestep = 1 / 60;

    for (const g of map.grounds) cuboid(this.world, g, G_WORLD);
    // Los muros ya incluyen alféizares y dinteles; el hueco de cada ventana frena solo al jugador.
    for (const wall of map.walls) cuboid(this.world, wall, G_WORLD);
    for (const w of map.windows) {
      const [x0, z0, x1, z1] = w.opening;
      cuboid(this.world, [x0, w.sillTop, z0, x1, w.top, z1], G_WINDOW_BLOCK);
    }
    // Rampas y escaleras: una losa inclinada por la que se sube andando.
    for (const r of map.ramps) {
      const [x0, z0, x1, z1] = r.rect;
      const run = r.axis === 'x' ? x1 - x0 : z1 - z0;
      const across = r.axis === 'x' ? z1 - z0 : x1 - x0;
      const angle = Math.atan2(r.y1 - r.y0, run);
      const half = RAMP_THICKNESS / 2;
      const len = Math.hypot(run, r.y1 - r.y0) / 2;
      const desc = (r.axis === 'x' ? RAPIER.ColliderDesc.cuboid(len, half, across / 2) : RAPIER.ColliderDesc.cuboid(across / 2, half, len))
        .setTranslation((x0 + x1) / 2, (r.y0 + r.y1) / 2 - half / Math.cos(angle), (z0 + z1) / 2)
        .setRotation(
          r.axis === 'x'
            ? { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) }
            : { x: Math.sin(-angle / 2), y: 0, z: 0, w: Math.cos(-angle / 2) },
        )
        .setCollisionGroups(G_WORLD);
      this.world.createCollider(desc);
    }
    for (const d of map.doors) this.doorColliders.push(cuboid(this.world, d.box, G_WORLD));
    for (const b of solidBoxes(map)) cuboid(this.world, b, G_WORLD);

    // Jugador: cápsula movida por el controlador de personaje.
    this.playerBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(playerStart.x, playerStart.y + CAPSULE_CENTER, playerStart.z),
    );
    this.playerCollider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(PLAYER_HEIGHT / 2 - PLAYER_RADIUS, PLAYER_RADIUS).setCollisionGroups(G_PLAYER),
      this.playerBody,
    );
    this.controller = this.world.createCharacterController(KCC_OFFSET);
    this.controller.enableSnapToGround(0.3);
    // Se sube por escaleras y rampas; las pendientes de más de 45° no se pueden subir.
    this.controller.setMaxSlopeClimbAngle((45 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((50 * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(false);

    // Reserva fija de cuerpos de enemigo (regla 5): se encienden y apagan, nunca se crean en plena horda.
    for (let i = 0; i < enemyPool; i++) {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -50, 0).setEnabled(false),
      );
      const sets = { vacio: [] as Collider[], jauria: [] as Collider[] };
      for (const kind of ['vacio', 'jauria'] as const) {
        for (const p of ENEMY_PARTS[kind]) {
          const desc =
            p.halfHeight > 0 ? RAPIER.ColliderDesc.capsule(p.halfHeight, p.radius) : RAPIER.ColliderDesc.ball(p.radius);
          desc.setTranslation(p.at[0], p.at[1], p.at[2]).setCollisionGroups(G_ENEMY);
          if (p.lying) desc.setRotation(LYING);
          const c = this.world.createCollider(desc, body);
          c.setEnabled(kind === 'vacio');
          this.enemyParts.set(c.handle, { enemy: i, part: p.part });
          sets[kind].push(c);
        }
      }
      this.enemyColliders.push(sets);
      this.enemyKinds.push('vacio');
      this.enemyBodies.push(body);
    }
    this.world.step();
  }

  /** Mueve al jugador chocando con muros. Devuelve la nueva posición de los pies. */
  movePlayer(feet: Vec3, delta: Vec3): Vec3 {
    this.controller.computeColliderMovement(this.playerCollider, delta, undefined, G_PLAYER);
    const m = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    const next = { x: feet.x + m.x, y: feet.y + m.y, z: feet.z + m.z };
    this.playerBody.setNextKinematicTranslation({ x: next.x, y: next.y + CAPSULE_CENTER, z: next.z });
    return next;
  }

  /** Coloca al jugador sin comprobar choques (pruebas y reaparición). */
  teleportPlayer(feet: Vec3): void {
    this.playerBody.setTranslation({ x: feet.x, y: feet.y + CAPSULE_CENTER, z: feet.z }, true);
    this.playerBody.setNextKinematicTranslation({ x: feet.x, y: feet.y + CAPSULE_CENTER, z: feet.z });
  }

  isGrounded(): boolean {
    return this.grounded;
  }

  /** Coloca un enemigo. `yaw` lo gira (importa en los alargados, como La Jauría). */
  setEnemy(index: number, active: boolean, pos?: Vec3, yaw = 0): void {
    const body = this.enemyBodies[index]!;
    if (body.isEnabled() !== active) {
      body.setEnabled(active);
      if (active && pos) body.setTranslation(pos, true);
    }
    if (active && pos) {
      body.setNextKinematicTranslation(pos);
      body.setNextKinematicRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
    }
  }

  /** Cambia las partes de impacto de un enemigo al tipo dado. */
  setEnemyKind(index: number, kind: EnemyKind): void {
    if (this.enemyKinds[index] === kind) return;
    this.enemyKinds[index] = kind;
    const sets = this.enemyColliders[index]!;
    for (const k of ['vacio', 'jauria'] as const) for (const c of sets[k]) c.setEnabled(k === kind);
  }

  openDoor(index: number): void {
    const c = this.doorColliders[index];
    if (c) c.setEnabled(false);
  }

  /** Avanza el mundo: aplica los movimientos pedidos y actualiza las consultas de rayos. */
  step(): void {
    this.world.step();
  }

  /**
   * Rayo que atraviesa hasta `maxEnemies` enemigos distintos y se para en el escenario.
   * Devuelve los impactos en orden de distancia.
   */
  raycastPierce(origin: Vec3, dir: Vec3, maxDistance: number, maxEnemies: number): PierceResult {
    const hits: RayHit[] = [];
    const skip = new Set<number>();
    const ray = new RAPIER.Ray(origin, dir);
    for (let i = 0; i < maxEnemies; i++) {
      const hit = this.world.castRayAndGetNormal(ray, maxDistance, true, undefined, G_RAY, undefined, undefined, (c) => {
        const part = this.enemyParts.get(c.handle);
        return !part || !skip.has(part.enemy);
      });
      if (!hit) break;
      const part = this.enemyParts.get(hit.collider.handle);
      // Escenario: la bala se para ahí.
      if (!part) return { hits, wall: { distance: hit.timeOfImpact, normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z } } };
      skip.add(part.enemy);
      hits.push({ distance: hit.timeOfImpact, enemy: part.enemy, part: part.part });
    }
    return { hits, wall: null };
  }

  raycast(origin: Vec3, dir: Vec3, maxDistance: number): RayHit | null {
    const hit = this.world.castRay(new RAPIER.Ray(origin, dir), maxDistance, true, undefined, G_RAY);
    if (!hit) return null;
    const part = this.enemyParts.get(hit.collider.handle);
    return { distance: hit.timeOfImpact, enemy: part ? part.enemy : -1, part: part ? part.part : null };
  }

  free(): void {
    this.world.free();
  }
}
