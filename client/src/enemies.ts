/**
 * Los Vacíos en pantalla: una reserva fija de personajes animados (regla 5),
 * creada al arrancar. Cada uno elige su animación según lo que hace en la
 * simulación. Si el modelo no carga, se dibujan cápsulas grises.
 */
import * as THREE from 'three/webgpu';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { EnemyState, Game } from '../../shared/sim/game';
import type { SimEvent } from '../../shared/sim/types';
import { getModel } from './models';

export const ENEMY_MODEL = 'vacio';

type Clip = 'andar' | 'correr' | 'esprintar' | 'atacar' | 'impacto' | 'trepar';

/** Velocidad (m/s) a la que cada animación de pasos se ve natural: se acelera o frena según la real. */
const CLIP_SPEED: Partial<Record<Clip, number>> = { andar: 1.1, correr: 3.6, esprintar: 5.6 };
const FADE = 0.2;
const HIT_SECONDS = 0.35;
/** Tres variantes de color sobre el mismo modelo (GDD: tres variantes de ropa y color). */
const VARIANTS = [0xffffff, 0xc9d4ff, 0xffd9c2];

interface Unit {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Map<Clip, THREE.AnimationAction>;
  current: Clip | null;
  hitTimer: number;
}

export class EnemyViews {
  private readonly units: Unit[] = [];
  private readonly fallback: THREE.InstancedMesh | null = null;

  constructor(scene: THREE.Scene, poolSize: number) {
    const model = getModel(ENEMY_MODEL);
    if (!model) {
      const geo = new THREE.CapsuleGeometry(0.28, 0.95, 4, 10);
      geo.translate(0, 0.28 + 0.95 / 2 + 0.05, 0);
      this.fallback = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x4a4f5c, roughness: 0.85 }), poolSize);
      this.fallback.frustumCulled = false;
      for (let i = 0; i < poolSize; i++) this.fallback.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
      scene.add(this.fallback);
      return;
    }
    // Un material por variante, compartido por todos los de esa variante.
    const variantMats = VARIANTS.map((tint) => new Map<THREE.Material, THREE.Material>());
    for (let i = 0; i < poolSize; i++) {
      const root = cloneSkinned(model.scene);
      const v = i % VARIANTS.length;
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.frustumCulled = false;
        const src = mesh.material as THREE.MeshStandardMaterial;
        let mat = variantMats[v]!.get(src);
        if (!mat) {
          mat = src.clone();
          (mat as THREE.MeshStandardMaterial).color.multiply(new THREE.Color(VARIANTS[v]!));
          variantMats[v]!.set(src, mat);
        }
        mesh.material = mat;
      });
      root.visible = false;
      scene.add(root);
      const mixer = new THREE.AnimationMixer(root);
      const actions = new Map<Clip, THREE.AnimationAction>();
      for (const clip of model.animations) actions.set(clip.name as Clip, mixer.clipAction(clip));
      const climb = actions.get('trepar');
      if (climb) {
        climb.setLoop(THREE.LoopOnce, 1);
        climb.clampWhenFinished = true;
      }
      this.units.push({ root, mixer, actions, current: null, hitTimer: 0 });
    }
  }

  onEvent(ev: SimEvent): void {
    if (ev.type === 'hit' && !ev.killed) {
      const u = this.units[ev.enemy];
      if (u) u.hitTimer = HIT_SECONDS;
    } else if (ev.type === 'enemySpawned') {
      const u = this.units[ev.enemy];
      if (u) {
        u.mixer.stopAllAction();
        u.current = null;
      }
    }
  }

  private choose(e: EnemyState, game: Game): Clip {
    const p = game.player.pos;
    const attacking = Math.hypot(p.x - e.pos.x, p.z - e.pos.z) <= game.cfg.enemies.attackRange;
    if (e.phase === 'climbing') return 'trepar';
    if (e.phase === 'tearing' || attacking) return 'atacar';
    if (e.speed >= 5.5) return 'esprintar';
    if (e.speed >= 3) return 'correr';
    return 'andar';
  }

  private play(u: Unit, clip: Clip, game: Game): void {
    const action = u.actions.get(clip);
    if (!action) return;
    if (u.current === clip) return;
    const prev = u.current ? u.actions.get(u.current) : null;
    action.reset();
    if (clip === 'trepar') action.setDuration(game.cfg.enemies.climbSeconds);
    action.play();
    if (prev) action.crossFadeFrom(prev, FADE, false);
    u.current = clip;
  }

  update(game: Game, alpha: number, dt: number): void {
    const lerp = (a: number, b: number) => a + (b - a) * alpha;
    if (this.fallback) {
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      for (const e of game.enemies) {
        if (e.phase === 'inactive') m.makeScale(0, 0, 0);
        else m.compose(new THREE.Vector3(lerp(e.prevPos.x, e.pos.x), lerp(e.prevPos.y, e.pos.y), lerp(e.prevPos.z, e.pos.z)), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), e.yaw), new THREE.Vector3(1, 1, 1));
        this.fallback.setMatrixAt(e.index, m);
      }
      this.fallback.instanceMatrix.needsUpdate = true;
      return;
    }
    for (const e of game.enemies) {
      const u = this.units[e.index];
      if (!u) continue;
      if (e.phase === 'inactive') {
        u.root.visible = false;
        continue;
      }
      u.root.visible = true;
      u.root.position.set(lerp(e.prevPos.x, e.pos.x), lerp(e.prevPos.y, e.pos.y), lerp(e.prevPos.z, e.pos.z));
      // El modelo mira hacia +z; en la simulación, el giro 0 mira hacia -z.
      u.root.rotation.y = e.yaw + Math.PI;
      const clip = this.choose(e, game);
      this.play(u, clip, game);
      const action = u.actions.get(clip);
      const ref = CLIP_SPEED[clip];
      if (action && ref) action.timeScale = Math.max(0.5, e.speed / ref);
      // Al recibir un impacto, un tirón breve de la animación de golpe por encima.
      const hit = u.actions.get('impacto');
      if (hit) {
        if (u.hitTimer > 0) {
          u.hitTimer -= dt;
          if (!hit.isRunning()) hit.reset().play();
          hit.setEffectiveWeight(Math.min(1, u.hitTimer / HIT_SECONDS) * 0.6);
        } else if (hit.isRunning()) {
          hit.stop();
        }
      }
      u.mixer.update(dt);
    }
  }
}
