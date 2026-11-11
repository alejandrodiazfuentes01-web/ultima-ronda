/**
 * Mundo físico (Rapier): muros, ventanas, puertas, el jugador y las cápsulas
 * de impacto de los enemigos. Los disparos son rayos instantáneos.
 */
import type { Box, MapConfig } from '../config';
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

/** Partes de impacto del enemigo: altura del centro, forma y tamaño. */
const ENEMY_PARTS: Array<{ part: HitPart; y: number; halfHeight: number; radius: number }> = [
  { part: 'head', y: 1.6, halfHeight: 0, radius: 0.16 },
  { part: 'torso', y: 1.15, halfHeight: 0.22, radius: 0.26 },
  { part: 'limb', y: 0.45, halfHeight: 0.25, radius: 0.22 },
];

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

export class Physics {
  readonly world: World;
  private readonly controller;
  private readonly playerBody: RigidBody;
  private readonly playerCollider: Collider;
  private readonly doorColliders: Collider[] = [];
  private readonly enemyBodies: RigidBody[] = [];
  /** Asocia cada colisionador de enemigo con su enemigo y su parte. */
  private readonly enemyParts = new Map<number, { enemy: number; part: HitPart }>();
  private grounded = false;

  constructor(map: MapConfig, enemyPool: number, playerStart: Vec3) {
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.world.timestep = 1 / 60;

    cuboid(this.world, map.floor, G_WORLD);
    for (const wall of map.walls) cuboid(this.world, wall, G_WORLD);
    for (const w of map.windows) {
      const [x0, z0, x1, z1] = w.opening;
      cuboid(this.world, [x0, 0, z0, x1, map.sillHeight, z1], G_WORLD);
      cuboid(this.world, [x0, map.windowTop, z0, x1, map.wallHeight, z1], G_WORLD);
      cuboid(this.world, [x0, map.sillHeight, z0, x1, map.windowTop, z1], G_WINDOW_BLOCK);
    }
    for (const d of map.doors) this.doorColliders.push(cuboid(this.world, d.box, G_WORLD));

    // Jugador: cápsula movida por el controlador de personaje.
    this.playerBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(playerStart.x, playerStart.y + PLAYER_HEIGHT / 2, playerStart.z),
    );
    this.playerCollider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(PLAYER_HEIGHT / 2 - PLAYER_RADIUS, PLAYER_RADIUS).setCollisionGroups(G_PLAYER),
      this.playerBody,
    );
    this.controller = this.world.createCharacterController(0.02);
    this.controller.enableSnapToGround(0.3);
    this.controller.setApplyImpulsesToDynamicBodies(false);

    // Reserva fija de cuerpos de enemigo (regla 5): se encienden y apagan, nunca se crean en plena horda.
    for (let i = 0; i < enemyPool; i++) {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -50, 0).setEnabled(false),
      );
      for (const p of ENEMY_PARTS) {
        const desc =
          p.halfHeight > 0 ? RAPIER.ColliderDesc.capsule(p.halfHeight, p.radius) : RAPIER.ColliderDesc.ball(p.radius);
        const c = this.world.createCollider(desc.setTranslation(0, p.y, 0).setCollisionGroups(G_ENEMY), body);
        this.enemyParts.set(c.handle, { enemy: i, part: p.part });
      }
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
    this.playerBody.setNextKinematicTranslation({ x: next.x, y: next.y + PLAYER_HEIGHT / 2, z: next.z });
    return next;
  }

  /** Coloca al jugador sin comprobar choques (pruebas y reaparición). */
  teleportPlayer(feet: Vec3): void {
    this.playerBody.setTranslation({ x: feet.x, y: feet.y + PLAYER_HEIGHT / 2, z: feet.z }, true);
    this.playerBody.setNextKinematicTranslation({ x: feet.x, y: feet.y + PLAYER_HEIGHT / 2, z: feet.z });
  }

  isGrounded(): boolean {
    return this.grounded;
  }

  setEnemy(index: number, active: boolean, pos?: Vec3): void {
    const body = this.enemyBodies[index]!;
    if (body.isEnabled() !== active) {
      body.setEnabled(active);
      if (active && pos) body.setTranslation(pos, true);
    }
    if (active && pos) body.setNextKinematicTranslation(pos);
  }

  openDoor(index: number): void {
    const c = this.doorColliders[index];
    if (c) c.setEnabled(false);
  }

  /** Avanza el mundo: aplica los movimientos pedidos y actualiza las consultas de rayos. */
  step(): void {
    this.world.step();
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
