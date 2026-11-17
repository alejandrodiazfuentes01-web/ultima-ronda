/**
 * Efectos de la partida, todos desde reservas fijas (regla 5):
 * ceniza al caer cada Vacío, la descarga del Arco voltaico, la onda de La Forja,
 * los power-ups que flotan en el suelo y los disparos: trazadoras, chispas,
 * agujeros de bala y polvo de ceniza al dar a un Vacío.
 */
import * as THREE from 'three/webgpu';
import type { PowerupKind } from '../../shared/config';
import type { Game } from '../../shared/sim/game';
import type { SimEvent, Vec3 } from '../../shared/sim/types';
import { bulletHoleTexture } from './textures';

const ASH_POOL = 360;
const ASH_PER_DEATH = 22;
const ARC_POOL = 12;
const ARC_POINTS = 9;
const ARC_LIFE = 0.16;
const WAVE_POOL = 4;
const WAVE_LIFE = 0.45;
const PICKUP_POOL = 8;
const TRACER_POOL = 32;
const TRACER_LIFE = 0.06;
const SPARK_POOL = 72;
const SPARKS_PER_HIT = 6;
const HOLE_POOL = 64;
const HOLE_SIZE = 0.07;
const DUST_PER_HIT = 3;
const PUFF_PER_HIT = 5;

const PICKUP_COLOR: Record<PowerupKind, number> = {
  municionCompleta: 0x7cff6a,
  bajaInstantanea: 0xff4040,
  puntosDobles: 0xffd84a,
  ondaExpansiva: 0x66b8ff,
};

const tmpM = new THREE.Matrix4();
const tmpP = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
const tmpP2 = new THREE.Vector3();
const tmpQ2 = new THREE.Quaternion();
const zAxis = new THREE.Vector3(0, 0, 1);

export class Effects {
  private readonly ash: THREE.InstancedMesh;
  private readonly ashPos = new Float32Array(ASH_POOL * 3);
  private readonly ashVel = new Float32Array(ASH_POOL * 3);
  private readonly ashLife = new Float32Array(ASH_POOL);
  private nextAsh = 0;

  private readonly arcs: Array<{ line: THREE.Line; life: number }> = [];
  private nextArc = 0;
  private readonly waves: Array<{ mesh: THREE.Mesh; life: number }> = [];
  private nextWave = 0;
  private readonly pickups: Array<{ group: THREE.Group; mats: THREE.MeshBasicMaterial[]; kind: PowerupKind | null }> = [];

  private readonly tracers: THREE.InstancedMesh;
  private readonly tracerFrom = new Float32Array(TRACER_POOL * 3);
  private readonly tracerTo = new Float32Array(TRACER_POOL * 3);
  private readonly tracerLife = new Float32Array(TRACER_POOL);
  private nextTracer = 0;
  private readonly sparks: THREE.InstancedMesh;
  private readonly sparkPos = new Float32Array(SPARK_POOL * 3);
  private readonly sparkVel = new Float32Array(SPARK_POOL * 3);
  private readonly sparkLife = new Float32Array(SPARK_POOL);
  private nextSpark = 0;
  private readonly holes: THREE.InstancedMesh;
  private nextHole = 0;

  constructor(scene: THREE.Scene) {
    this.ash = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.06, 0.06, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 1 }),
      ASH_POOL,
    );
    for (let i = 0; i < ASH_POOL; i++) this.ash.setMatrixAt(i, hidden);
    this.ash.frustumCulled = false;
    scene.add(this.ash);

    for (let i = 0; i < ARC_POOL; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(ARC_POINTS * 3), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x9fe8ff }));
      line.visible = false;
      line.frustumCulled = false;
      this.arcs.push({ line, life: 0 });
      scene.add(line);
    }

    for (let i = 0; i < WAVE_POOL; i++) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.85, 1, 32),
        new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.waves.push({ mesh, life: 0 });
      scene.add(mesh);
    }

    // Trazadoras: un haz fino y breve de la boca del cañón al impacto.
    this.tracers = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }),
      TRACER_POOL,
    );
    this.sparks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.018, 0.018, 0.018), new THREE.MeshBasicMaterial({ color: 0xffc070 }), SPARK_POOL);
    this.holes = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(HOLE_SIZE, HOLE_SIZE),
      new THREE.MeshBasicMaterial({
        map: bulletHoleTexture(),
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
      HOLE_POOL,
    );
    for (const [mesh, n] of [
      [this.tracers, TRACER_POOL],
      [this.sparks, SPARK_POOL],
      [this.holes, HOLE_POOL],
    ] as const) {
      for (let i = 0; i < n; i++) mesh.setMatrixAt(i, hidden);
      mesh.frustumCulled = false;
      scene.add(mesh);
    }

    for (let i = 0; i < PICKUP_POOL; i++) {
      const group = new THREE.Group();
      const outer = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
      const inner = new THREE.MeshBasicMaterial({ color: 0xffffff });
      group.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.28), outer));
      group.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.13), inner));
      group.visible = false;
      this.pickups.push({ group, mats: [outer, inner], kind: null });
      scene.add(group);
    }
  }

  onEvent(ev: SimEvent, game: Game): void {
    if (ev.type === 'impact') {
      if (ev.surface === 'world') {
        this.burstSparks(ev.at);
        this.burstAsh(ev.at, DUST_PER_HIT, 0.4);
        if (ev.normal) this.hole(ev.at, ev.normal);
      } else {
        this.burstAsh(ev.at, PUFF_PER_HIT, 0.6);
      }
    } else if (ev.type === 'hit' && ev.killed) {
      const e = game.enemies[ev.enemy];
      if (e) this.burstAsh(e.pos);
    } else if (ev.type === 'chain') {
      this.arc(ev.from, ev.to);
    } else if (ev.type === 'ashWave') {
      const w = this.waves[this.nextWave]!;
      this.nextWave = (this.nextWave + 1) % WAVE_POOL;
      w.life = WAVE_LIFE;
      w.mesh.position.set(ev.at.x, 0.1, ev.at.z);
      w.mesh.visible = true;
    }
  }

  /**
   * Ceniza: al caer un Vacío, todo el cuerpo se deshace (sin `count`); en un impacto,
   * unas pocas motas justo donde dio la bala.
   */
  private burstAsh(at: Vec3, count?: number, life = 1): void {
    const whole = count === undefined;
    for (let k = 0; k < (count ?? ASH_PER_DEATH); k++) {
      const i = this.nextAsh;
      this.nextAsh = (this.nextAsh + 1) % ASH_POOL;
      this.ashPos[i * 3] = at.x + (Math.random() - 0.5) * (whole ? 0.5 : 0.1);
      this.ashPos[i * 3 + 1] = at.y + (whole ? 0.2 + Math.random() * 1.5 : (Math.random() - 0.5) * 0.1);
      this.ashPos[i * 3 + 2] = at.z + (Math.random() - 0.5) * (whole ? 0.5 : 0.1);
      this.ashVel[i * 3] = (Math.random() - 0.5) * 1.2;
      this.ashVel[i * 3 + 1] = 0.4 + Math.random() * 1.2;
      this.ashVel[i * 3 + 2] = (Math.random() - 0.5) * 1.2;
      this.ashLife[i] = (0.8 + Math.random() * 0.7) * life;
    }
  }

  /** Haz de una bala, desde la boca del cañón hasta donde acabó. */
  tracer(from: Vec3, to: Vec3): void {
    const i = this.nextTracer;
    this.nextTracer = (this.nextTracer + 1) % TRACER_POOL;
    this.tracerFrom.set([from.x, from.y, from.z], i * 3);
    this.tracerTo.set([to.x, to.y, to.z], i * 3);
    this.tracerLife[i] = TRACER_LIFE;
  }

  private burstSparks(at: Vec3): void {
    for (let k = 0; k < SPARKS_PER_HIT; k++) {
      const i = this.nextSpark;
      this.nextSpark = (this.nextSpark + 1) % SPARK_POOL;
      this.sparkPos.set([at.x, at.y, at.z], i * 3);
      this.sparkVel.set([(Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4], i * 3);
      this.sparkLife[i] = 0.12 + Math.random() * 0.15;
    }
  }

  /** Agujero de bala pegado a la pared, mirando hacia fuera de ella. */
  private hole(at: Vec3, normal: Vec3): void {
    const i = this.nextHole;
    this.nextHole = (this.nextHole + 1) % HOLE_POOL;
    tmpS.set(normal.x, normal.y, normal.z).normalize();
    tmpQ.setFromUnitVectors(zAxis, tmpS);
    tmpQ.multiply(tmpQ2.setFromAxisAngle(zAxis, Math.random() * Math.PI * 2));
    const s = 0.7 + Math.random() * 0.6;
    tmpM.compose(tmpP.set(at.x + normal.x * 0.004, at.y + normal.y * 0.004, at.z + normal.z * 0.004), tmpQ, tmpS.set(s, s, s));
    this.holes.setMatrixAt(i, tmpM);
    this.holes.instanceMatrix.needsUpdate = true;
  }

  private arc(from: Vec3, to: Vec3): void {
    const a = this.arcs[this.nextArc]!;
    this.nextArc = (this.nextArc + 1) % ARC_POOL;
    const attr = a.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < ARC_POINTS; i++) {
      const t = i / (ARC_POINTS - 1);
      const jitter = i === 0 || i === ARC_POINTS - 1 ? 0 : 0.25;
      attr.setXYZ(
        i,
        from.x + (to.x - from.x) * t + (Math.random() - 0.5) * jitter,
        from.y + (to.y - from.y) * t + (Math.random() - 0.5) * jitter,
        from.z + (to.z - from.z) * t + (Math.random() - 0.5) * jitter,
      );
    }
    attr.needsUpdate = true;
    a.life = ARC_LIFE;
    a.line.visible = true;
  }

  update(game: Game, dt: number, time: number): void {
    // Ceniza.
    for (let i = 0; i < ASH_POOL; i++) {
      if (this.ashLife[i]! <= 0) continue;
      this.ashLife[i] = this.ashLife[i]! - dt;
      if (this.ashLife[i]! <= 0) {
        this.ash.setMatrixAt(i, hidden);
        continue;
      }
      this.ashVel[i * 3 + 1] = this.ashVel[i * 3 + 1]! - 2.2 * dt;
      for (let c = 0; c < 3; c++) this.ashPos[i * 3 + c] = this.ashPos[i * 3 + c]! + this.ashVel[i * 3 + c]! * dt;
      const y = Math.max(0.03, this.ashPos[i * 3 + 1]!);
      const s = Math.min(1, this.ashLife[i]! * 2);
      tmpP.set(this.ashPos[i * 3]!, y, this.ashPos[i * 3 + 2]!);
      tmpQ.setFromAxisAngle(tmpS.set(1, 1, 0).normalize(), time * 4 + i);
      tmpS.set(s, s, s);
      tmpM.compose(tmpP, tmpQ, tmpS);
      this.ash.setMatrixAt(i, tmpM);
    }
    this.ash.instanceMatrix.needsUpdate = true;

    // Trazadoras: se adelgazan hasta desaparecer.
    let anyTracer = false;
    for (let i = 0; i < TRACER_POOL; i++) {
      if (this.tracerLife[i]! <= 0) continue;
      anyTracer = true;
      this.tracerLife[i] = this.tracerLife[i]! - dt;
      if (this.tracerLife[i]! <= 0) {
        this.tracers.setMatrixAt(i, hidden);
        continue;
      }
      const fx = this.tracerFrom[i * 3]!;
      const fy = this.tracerFrom[i * 3 + 1]!;
      const fz = this.tracerFrom[i * 3 + 2]!;
      tmpP.set(this.tracerTo[i * 3]! - fx, this.tracerTo[i * 3 + 1]! - fy, this.tracerTo[i * 3 + 2]! - fz);
      const len = tmpP.length();
      tmpQ.setFromUnitVectors(zAxis, tmpP.normalize());
      const w = 0.012 * (this.tracerLife[i]! / TRACER_LIFE);
      tmpM.compose(tmpP2.set(fx, fy, fz).addScaledVector(tmpP, len / 2), tmpQ, tmpS.set(w, w, len));
      this.tracers.setMatrixAt(i, tmpM);
    }
    if (anyTracer) this.tracers.instanceMatrix.needsUpdate = true;

    let anySpark = false;
    for (let i = 0; i < SPARK_POOL; i++) {
      if (this.sparkLife[i]! <= 0) continue;
      anySpark = true;
      this.sparkLife[i] = this.sparkLife[i]! - dt;
      if (this.sparkLife[i]! <= 0) {
        this.sparks.setMatrixAt(i, hidden);
        continue;
      }
      this.sparkVel[i * 3 + 1] = this.sparkVel[i * 3 + 1]! - 9.8 * dt;
      for (let c = 0; c < 3; c++) this.sparkPos[i * 3 + c] = this.sparkPos[i * 3 + c]! + this.sparkVel[i * 3 + c]! * dt;
      const s = Math.min(1, this.sparkLife[i]! * 8);
      tmpM.compose(tmpP.set(this.sparkPos[i * 3]!, this.sparkPos[i * 3 + 1]!, this.sparkPos[i * 3 + 2]!), tmpQ.identity(), tmpS.set(s, s, s));
      this.sparks.setMatrixAt(i, tmpM);
    }
    if (anySpark) this.sparks.instanceMatrix.needsUpdate = true;

    for (const a of this.arcs) {
      if (a.life <= 0) continue;
      a.life -= dt;
      a.line.visible = a.life > 0;
    }

    for (const w of this.waves) {
      if (w.life <= 0) continue;
      w.life -= dt;
      const t = 1 - w.life / WAVE_LIFE;
      const r = game.cfg.forja.ashWave.radius * t;
      w.mesh.scale.set(r, r, r);
      (w.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.8;
      w.mesh.visible = w.life > 0;
    }

    // Power-ups en el suelo: giran, flotan y parpadean al final.
    const blink = game.cfg.powerups.blinkSeconds;
    game.pickups.forEach((pu, i) => {
      const view = this.pickups[i];
      if (!view) return;
      const visible = pu.active && (pu.timer > blink || Math.sin(time * 18) > 0);
      view.group.visible = visible;
      if (!pu.active) return;
      if (view.kind !== pu.kind) {
        view.kind = pu.kind;
        for (const m of view.mats) m.color.setHex(PICKUP_COLOR[pu.kind] ?? 0xffffff);
      }
      view.group.position.set(pu.x, 0.7 + Math.sin(time * 2.5 + i) * 0.12, pu.z);
      view.group.rotation.y = time * 2;
    });
  }
}
