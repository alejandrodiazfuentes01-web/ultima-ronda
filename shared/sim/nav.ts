/**
 * Navegación de los enemigos dentro del edificio: malla de navegación (recast)
 * por baldosas, para poder cerrarla en las compuertas, y multitud de agentes que
 * se esquivan entre sí.
 *
 * Cada compuerta cerrada es un obstáculo en la malla: los Vacíos no pueden cruzarla
 * ni buscar un atajo por una zona cerrada. Al abrirla se quita el obstáculo y la
 * malla se rehace solo en las baldosas de alrededor, sin tirones.
 */
import { Crowd, type CrowdAgent, type NavMesh, NavMeshQuery, type Obstacle, type TileCache } from '@recast-navigation/core';
import { generateTileCache } from '@recast-navigation/generators';
import type { Box, MapConfig } from '../config';
import { solidBoxes } from './physics';
import type { Vec3 } from './types';

/** Medidas del agente y de la malla (geometría, no balance). */
export const AGENT_RADIUS = 0.35;
/**
 * Hueco que ocupa cada Vacío en la multitud: más estrecho que el margen de la malla,
 * para que vayan apiñados hombro con hombro, como sus cuerpos delgados.
 */
const CROWD_RADIUS = 0.22;
const AGENT_HEIGHT = 1.8;
const CELL = 0.1;
const CELL_HEIGHT = 0.1;
/** Lado de cada baldosa de la malla, en celdas. */
const TILE_CELLS = 48;
/** Cuántas veces se puede rehacer seguida la malla hasta que quede al día. */
const MAX_TILE_UPDATES = 32;

export class Navigation {
  readonly navMesh: NavMesh;
  readonly crowd: Crowd;
  private readonly tileCache: TileCache;
  private readonly query: NavMeshQuery;
  private readonly doorObstacles: Array<Obstacle | null> = [];

  constructor(map: MapConfig, maxAgents: number) {
    // El suelo transitable: cada sala a su altura y cada rampa inclinada, en dos triángulos.
    const positions: number[] = [];
    const indices: number[] = [];
    const quad = (a: number[], b: number[], c: number[], d: number[]) => {
      const base = positions.length / 3;
      positions.push(...a, ...b, ...c, ...d);
      indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    };
    for (const zone of map.zones) {
      for (const { rect: [x0, z0, x1, z1], floor: y } of zone.rooms) quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]);
    }
    for (const r of map.ramps) {
      const [x0, z0, x1, z1] = r.rect;
      // Las rampas se alargan un poco dentro de las salas para que no quede escalón en la unión.
      if (r.axis === 'x') quad([x0, r.y0, z0], [x1, r.y1, z0], [x1, r.y1, z1], [x0, r.y0, z1]);
      else quad([x0, r.y0, z0], [x1, r.y0, z0], [x1, r.y1, z1], [x0, r.y1, z1]);
    }
    // Todo lo sólido corta el suelo: muros, alféizares, bloques interiores, objetos y decorado.
    const solids: Box[] = [...map.walls, ...solidBoxes(map)];
    for (const w of map.windows) {
      const [x0, z0, x1, z1] = w.opening;
      solids.push([x0, Math.min(w.floorY, w.groundY), z0, x1, w.top, z1]);
    }
    for (const [x0, y0, z0, x1, y1, z1] of solids) {
      const base = positions.length / 3;
      for (const [x, y, z] of [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]] as const) {
        positions.push(x, y, z);
      }
      for (const [a, b, c] of [[4, 6, 5], [4, 7, 6], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]] as const) {
        indices.push(base + a, base + b, base + c);
      }
    }
    const result = generateTileCache(positions, indices, {
      cs: CELL,
      ch: CELL_HEIGHT,
      tileSize: TILE_CELLS,
      walkableRadius: Math.ceil(AGENT_RADIUS / CELL),
      walkableHeight: Math.ceil(AGENT_HEIGHT / CELL_HEIGHT),
      walkableClimb: 3,
      walkableSlopeAngle: 45,
      expectedLayersPerTile: 4,
      maxObstacles: Math.max(8, map.doors.length + 4),
    });
    if (!result.success || !result.navMesh || !result.tileCache) throw new Error('No se pudo generar la malla de navegación');
    this.navMesh = result.navMesh;
    this.tileCache = result.tileCache;
    // Todas las compuertas empiezan cerradas.
    for (const d of map.doors) {
      const [x0, y0, z0, x1, y1, z1] = d.box;
      const r = this.tileCache.addBoxObstacle(
        { x: (x0 + x1) / 2, y: (y0 + y1) / 2 - 0.5, z: (z0 + z1) / 2 },
        { x: (x1 - x0) / 2 + 0.15, y: (y1 - y0) / 2 + 0.5, z: (z1 - z0) / 2 + 0.15 },
        0,
      );
      this.doorObstacles.push(r.success ? r.obstacle : null);
    }
    this.flush();
    this.crowd = new Crowd(this.navMesh, { maxAgents, maxAgentRadius: 0.6 });
    this.query = new NavMeshQuery(this.navMesh);
  }

  /** Rehace las baldosas pendientes hasta que la malla esté al día. */
  private flush(): void {
    for (let i = 0; i < MAX_TILE_UPDATES; i++) {
      if (this.tileCache.update(this.navMesh).upToDate) return;
    }
  }

  /** La compuerta se abre: deja de cortar la malla. */
  openDoor(index: number): void {
    const o = this.doorObstacles[index];
    if (!o) return;
    this.tileCache.removeObstacle(o);
    this.doorObstacles[index] = null;
    this.flush();
  }

  /** Punto más cercano de la malla, o el mismo punto si no hay malla cerca. */
  closest(p: Vec3): Vec3 {
    const r = this.query.findClosestPoint(p, { halfExtents: { x: 2, y: 2, z: 2 } });
    return r.success ? r.point : p;
  }

  addAgent(p: Vec3, speed: number, horde: { separationWeight: number; collisionQueryRange: number; maxAcceleration: number }): CrowdAgent {
    return this.crowd.addAgent(this.closest(p), {
      radius: CROWD_RADIUS,
      height: AGENT_HEIGHT,
      maxSpeed: speed,
      maxAcceleration: horde.maxAcceleration,
      collisionQueryRange: horde.collisionQueryRange,
      pathOptimizationRange: 10,
      separationWeight: horde.separationWeight,
    });
  }

  removeAgent(agent: CrowdAgent): void {
    this.crowd.removeAgent(agent);
  }

  update(dt: number): void {
    this.crowd.update(dt);
  }

  free(): void {
    this.crowd.destroy();
    this.query.destroy();
    this.tileCache.destroy();
    this.navMesh.destroy();
  }
}
