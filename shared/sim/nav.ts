/**
 * Navegación de los enemigos dentro del edificio: malla de navegación
 * precalculada (recast) y multitud de agentes que se esquivan entre sí.
 */
import { Crowd, type CrowdAgent, type NavMesh, NavMeshQuery } from '@recast-navigation/core';
import { generateSoloNavMesh } from '@recast-navigation/generators';
import type { MapConfig } from '../config';
import { solidBoxes } from './physics';
import type { Vec3 } from './types';

/** Medidas del agente (geometría, no balance). */
export const AGENT_RADIUS = 0.35;
const AGENT_HEIGHT = 1.8;
const CELL = 0.1;
const CELL_HEIGHT = 0.1;

export class Navigation {
  readonly navMesh: NavMesh;
  readonly crowd: Crowd;
  private readonly query: NavMeshQuery;

  constructor(map: MapConfig, maxAgents: number) {
    // El suelo transitable del interior: rectángulos a y = 0, en dos triángulos cada uno.
    const positions: number[] = [];
    const indices: number[] = [];
    for (const [x0, z0, x1, z1] of map.navFloors) {
      const base = positions.length / 3;
      positions.push(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1);
      indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    // Los objetos sólidos del mapa se añaden como cajas: el suelo bajo ellos deja de ser transitable.
    for (const [x0, y0, z0, x1, y1, z1] of solidBoxes(map)) {
      const base = positions.length / 3;
      for (const [x, y, z] of [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]] as const) {
        positions.push(x, y, z);
      }
      for (const [a, b, c] of [[4, 6, 5], [4, 7, 6], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]] as const) {
        indices.push(base + a, base + b, base + c);
      }
    }
    const result = generateSoloNavMesh(positions, indices, {
      cs: CELL,
      ch: CELL_HEIGHT,
      walkableRadius: Math.ceil(AGENT_RADIUS / CELL),
      walkableHeight: Math.ceil(AGENT_HEIGHT / CELL_HEIGHT),
      walkableClimb: 3,
    });
    if (!result.success || !result.navMesh) throw new Error('No se pudo generar la malla de navegación');
    this.navMesh = result.navMesh;
    this.crowd = new Crowd(this.navMesh, { maxAgents, maxAgentRadius: 0.6 });
    this.query = new NavMeshQuery(this.navMesh);
  }

  /** Punto más cercano de la malla, o el mismo punto si no hay malla cerca. */
  closest(p: Vec3): Vec3 {
    const r = this.query.findClosestPoint(p, { halfExtents: { x: 2, y: 2, z: 2 } });
    return r.success ? r.point : p;
  }

  addAgent(p: Vec3, speed: number, horde: { separationWeight: number; collisionQueryRange: number }): CrowdAgent {
    return this.crowd.addAgent(this.closest(p), {
      radius: AGENT_RADIUS,
      height: AGENT_HEIGHT,
      maxSpeed: speed,
      maxAcceleration: 30,
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
    this.navMesh.destroy();
  }
}
