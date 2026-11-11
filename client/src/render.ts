/**
 * Dibuja la partida en cajas grises. Solo lee el estado de la simulación e
 * interpola entre el paso anterior y el actual (regla 2).
 * Escenario en una sola malla; enemigos y planchas en mallas instanciadas
 * de tamaño fijo (regla 5): pocas llamadas de dibujo y nada se crea en plena horda.
 */
import * as THREE from 'three/webgpu';
import type { Box, MapConfig } from '../../shared/config';
import type { Game } from '../../shared/sim/game';
import { EYE_HEIGHT } from '../../shared/sim/physics';
import type { SimEvent } from '../../shared/sim/types';
import { Viewmodel } from './viewmodel';

const COLORS = {
  sky: 0x10151b,
  floor: 0x3b4148,
  wall: 0x8d959e,
  trim: 0x6d757e,
  door: 0xb5703a,
  locker: 0x2f7f86,
  plank: 0x4d5863,
  enemy: 0x4a4f5c,
  enemyHead: 0x5d6270,
};

/** Une varias cajas en una sola geometría para dibujarlas de una vez. */
function boxesGeometry(boxes: Box[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (const b of boxes) {
    const g = new THREE.BoxGeometry(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
    g.translate((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
    const base = pos.length / 3;
    pos.push(...(g.getAttribute('position').array as Float32Array));
    nor.push(...(g.getAttribute('normal').array as Float32Array));
    for (const i of g.getIndex()!.array) idx.push(base + i);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}

/** Ancho de cada plancha metálica en metros (aspecto, no balance). */
const PLANK_WIDTH = 0.15;

/**
 * Disposición propia de las planchas de una ventana: un marco de cuatro y una
 * cruzada en diagonal, con el centro despejado para ver quién viene.
 * El orden es el de reparación; los enemigos las arrancan al revés: primero la
 * diagonal del centro, luego los laterales y al final las de arriba y abajo.
 * place = [posición a lo ancho (-1 a 1), altura (0 a 1), giro, capa].
 */
const PLANK_LAYOUT: Array<{ place: [number, number, number, number]; length: (w: number, h: number) => number }> = [
  { place: [0, 0.1, 0.03, 0], length: (w) => w + 0.3 },
  { place: [0, 0.9, -0.04, 0], length: (w) => w + 0.3 },
  { place: [-0.74, 0.5, Math.PI / 2 + 0.06, 1], length: (_w, h) => h + 0.25 },
  { place: [0.74, 0.5, Math.PI / 2 - 0.05, 1], length: (_w, h) => h + 0.25 },
  { place: [0, 0.5, 0.5, 2], length: (w, h) => Math.hypot(w, h) * 0.92 },
];

const tmpMatrix = new THREE.Matrix4();
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const yAxis = new THREE.Vector3(0, 1, 0);
const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

export class GameView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(75, 1, 0.05, 80);
  private readonly viewmodel: Viewmodel;
  private readonly enemyBodies: THREE.InstancedMesh;
  private readonly enemyHeads: THREE.InstancedMesh;
  private readonly planks: THREE.InstancedMesh;
  private readonly plankMatrices: THREE.Matrix4[] = [];
  private readonly doors: THREE.Mesh[] = [];
  private readonly planksPerWindow: number;

  constructor(map: MapConfig, poolSize: number) {
    this.scene.background = new THREE.Color(COLORS.sky);
    this.scene.fog = new THREE.Fog(COLORS.sky, 10, 38);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.scene.add(new THREE.HemisphereLight(0xc8d6e5, 0x2a2420, 1.1));
    const sun = new THREE.DirectionalLight(0xffe2bd, 2.0);
    sun.position.set(8, 14, 5);
    this.scene.add(sun);

    // Suelo.
    this.scene.add(new THREE.Mesh(boxesGeometry([map.floor]), new THREE.MeshStandardMaterial({ color: COLORS.floor, roughness: 1 })));

    // Muros, alféizares y dinteles en una sola malla.
    const walls: Box[] = [...map.walls];
    for (const w of map.windows) {
      const [x0, z0, x1, z1] = w.opening;
      walls.push([x0, 0, z0, x1, map.sillHeight, z1], [x0, map.windowTop, z0, x1, map.wallHeight, z1]);
    }
    this.scene.add(new THREE.Mesh(boxesGeometry(walls), new THREE.MeshStandardMaterial({ color: COLORS.wall, roughness: 0.9 })));

    // Compuertas.
    const doorMat = new THREE.MeshStandardMaterial({ color: COLORS.door, roughness: 0.6, metalness: 0.2 });
    for (const d of map.doors) {
      const mesh = new THREE.Mesh(boxesGeometry([d.box]), doorMat);
      this.doors.push(mesh);
      this.scene.add(mesh);
    }

    // Taquillas de armería: panel en el muro con la silueta del arma.
    const lockerMat = new THREE.MeshStandardMaterial({ color: COLORS.locker, roughness: 0.5, emissive: COLORS.locker, emissiveIntensity: 0.25 });
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.6 });
    for (const b of map.wallBuys) {
      const group = new THREE.Group();
      group.add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 0.06), lockerMat));
      const gun = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.16, 0.08), gunMat);
      gun.position.z = 0.06;
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.08), gunMat);
      grip.position.set(-0.05, -0.15, 0.06);
      group.add(gun, grip);
      // El ancla está delante del muro; el panel va pegado a él.
      group.position.set(b.anchor[0] - b.facing[0] * 0.66, 1.5, b.anchor[1] - b.facing[1] * 0.66);
      group.rotation.y = Math.atan2(b.facing[0], b.facing[1]);
      this.scene.add(group);
    }

    // Planchas de las ventanas: todas en una malla instanciada.
    this.planksPerWindow = map.planksPerWindow;
    const plankCount = map.windows.length * map.planksPerWindow;
    this.planks = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: COLORS.plank, roughness: 0.55, metalness: 0.5 }),
      plankCount,
    );
    const span = map.windowTop - map.sillHeight;
    for (const w of map.windows) {
      const [x0, z0, x1, z1] = w.opening;
      const alongX = x1 - x0 > z1 - z0;
      const out = new THREE.Vector2(w.outside[0] - w.inside[0], w.outside[1] - w.inside[1]).normalize();
      const width = alongX ? x1 - x0 : z1 - z0;
      const baseYaw = alongX ? 0 : Math.PI / 2;
      for (let i = 0; i < map.planksPerWindow; i++) {
        const spec = PLANK_LAYOUT[i % PLANK_LAYOUT.length]!;
        const [u, v, angle, layer] = spec.place;
        // En la cara interior del muro, donde el jugador las ve y las repara. Cada capa va un poco más hacia dentro.
        const depth = 0.04 + layer * 0.03;
        const along = u * (width / 2);
        const cx = alongX ? (x0 + x1) / 2 + along : (out.x > 0 ? x0 : x1) - out.x * depth;
        const cz = alongX ? (out.y > 0 ? z0 : z1) - out.y * depth : (z0 + z1) / 2 - along;
        tmpPos.set(cx, map.sillHeight + v * span, cz);
        tmpQuat.setFromEuler(new THREE.Euler(0, baseYaw, angle, 'YXZ'));
        tmpScale.set(spec.length(width, span), PLANK_WIDTH, 0.03);
        this.plankMatrices.push(new THREE.Matrix4().compose(tmpPos, tmpQuat, tmpScale));
      }
    }
    // Las instancias están repartidas por todo el mapa: sin esto, Three.js las descartaba
    // al acercarse a una ventana porque solo miraba la caja de origen.
    this.planks.frustumCulled = false;
    this.scene.add(this.planks);

    // Enemigos: cuerpo y cabeza, reserva fija.
    const bodyGeo = new THREE.CapsuleGeometry(0.28, 0.95, 4, 10);
    bodyGeo.translate(0, 0.28 + 0.95 / 2 + 0.05, 0);
    this.enemyBodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ color: COLORS.enemy, roughness: 0.85 }), poolSize);
    const headGeo = new THREE.SphereGeometry(0.17, 12, 8);
    headGeo.translate(0, 1.6, 0);
    this.enemyHeads = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ color: COLORS.enemyHead, roughness: 0.8 }), poolSize);
    for (let i = 0; i < poolSize; i++) {
      this.enemyBodies.setMatrixAt(i, hidden);
      this.enemyHeads.setMatrixAt(i, hidden);
    }
    this.enemyBodies.frustumCulled = false;
    this.enemyHeads.frustumCulled = false;
    this.scene.add(this.enemyBodies, this.enemyHeads);

    this.viewmodel = new Viewmodel(this.camera);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  onEvent(ev: SimEvent): void {
    this.viewmodel.onEvent(ev);
  }

  /** Coloca todo según el estado, interpolando con `alpha` entre el paso anterior y el actual. */
  update(game: Game, alpha: number, yaw: number, pitch: number, frameSeconds: number): void {
    const p = game.player;
    const lerp = (a: number, b: number) => a + (b - a) * alpha;
    this.camera.position.set(lerp(p.prevPos.x, p.pos.x), lerp(p.prevPos.y, p.pos.y) + EYE_HEIGHT, lerp(p.prevPos.z, p.pos.z));
    this.camera.rotation.set(pitch, yaw, 0);

    for (const e of game.enemies) {
      if (e.phase === 'inactive') {
        this.enemyBodies.setMatrixAt(e.index, hidden);
        this.enemyHeads.setMatrixAt(e.index, hidden);
        continue;
      }
      tmpPos.set(lerp(e.prevPos.x, e.pos.x), lerp(e.prevPos.y, e.pos.y), lerp(e.prevPos.z, e.pos.z));
      tmpQuat.setFromAxisAngle(yAxis, e.yaw);
      tmpScale.set(1, 1, 1);
      tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
      this.enemyBodies.setMatrixAt(e.index, tmpMatrix);
      this.enemyHeads.setMatrixAt(e.index, tmpMatrix);
    }
    this.enemyBodies.instanceMatrix.needsUpdate = true;
    this.enemyHeads.instanceMatrix.needsUpdate = true;

    for (let w = 0; w < game.windows.length; w++) {
      const planks = game.windows[w]!.planks;
      for (let i = 0; i < this.planksPerWindow; i++) {
        const k = w * this.planksPerWindow + i;
        this.planks.setMatrixAt(k, i < planks ? this.plankMatrices[k]! : hidden);
      }
    }
    this.planks.instanceMatrix.needsUpdate = true;

    game.doors.forEach((d, i) => {
      this.doors[i]!.visible = !d.open;
    });

    const slot = p.slots[p.current];
    this.viewmodel.update(game, slot?.weapon ?? null, frameSeconds);
  }
}
