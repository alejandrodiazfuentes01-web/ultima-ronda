/**
 * Efectos de la partida, todos desde reservas fijas (regla 5):
 * ceniza al caer cada Vacío, la descarga del Arco voltaico, la onda de La Forja
 * y los power-ups que flotan en el suelo.
 */
import * as THREE from 'three/webgpu';
import type { PowerupKind } from '../../shared/config';
import type { Game } from '../../shared/sim/game';
import type { SimEvent, Vec3 } from '../../shared/sim/types';

const ASH_POOL = 360;
const ASH_PER_DEATH = 22;
const ARC_POOL = 12;
const ARC_POINTS = 9;
const ARC_LIFE = 0.16;
const WAVE_POOL = 4;
const WAVE_LIFE = 0.45;
const PICKUP_POOL = 8;

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
    if (ev.type === 'hit' && ev.killed) {
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

  /** El Vacío se deshace en ceniza: partículas que suben un poco y caen. */
  private burstAsh(at: Vec3): void {
    for (let k = 0; k < ASH_PER_DEATH; k++) {
      const i = this.nextAsh;
      this.nextAsh = (this.nextAsh + 1) % ASH_POOL;
      this.ashPos[i * 3] = at.x + (Math.random() - 0.5) * 0.5;
      this.ashPos[i * 3 + 1] = at.y + 0.2 + Math.random() * 1.5;
      this.ashPos[i * 3 + 2] = at.z + (Math.random() - 0.5) * 0.5;
      this.ashVel[i * 3] = (Math.random() - 0.5) * 1.2;
      this.ashVel[i * 3 + 1] = 0.4 + Math.random() * 1.2;
      this.ashVel[i * 3 + 2] = (Math.random() - 0.5) * 1.2;
      this.ashLife[i] = 0.8 + Math.random() * 0.7;
    }
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
