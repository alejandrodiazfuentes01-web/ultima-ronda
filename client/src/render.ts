/**
 * Dibuja la partida: el Vestíbulo en cajas grises y el Laboratorio con su arte. Solo lee el estado de la simulación e
 * interpola entre el paso anterior y el actual (regla 2).
 * Escenario en una sola malla; enemigos y planchas en mallas instanciadas
 * de tamaño fijo (regla 5): pocas llamadas de dibujo y nada se crea en plena horda.
 */
import * as THREE from 'three/webgpu';
import type { Box, MapConfig } from '../../shared/config';
import type { Game } from '../../shared/sim/game';
import { EYE_HEIGHT } from '../../shared/sim/physics';
import type { SimEvent } from '../../shared/sim/types';
import { EnemyViews } from './enemies';
import { Effects } from './effects';
import { Props } from './props';
import { labFloorTexture, labWallTexture } from './textures';
import { Viewmodel } from './viewmodel';
import { buildWeapon } from './weapons/build';

/** Metros que cubre una repetición de las texturas del Laboratorio. */
const TEXTURE_METERS = 2;
/** Altura de los ojos al estar caído. */
const DOWNED_EYE = 0.55;
/** Campo de visión del mundo sin apuntar (aspecto, no balance). */
const BASE_FOV = 75;
const MUZZLE_LIGHT = 9;
/** Distancia a la que la niebla lo tapa todo, normal y durante La Jauría. */
const FOG_FAR = 30;
const PACK_FOG_FAR = 15;
const PACK_FOG_COLOR = new THREE.Color(0x241414);

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

/**
 * Une varias cajas en una sola geometría para dibujarlas de una vez. Las
 * coordenadas de textura salen de la posición en el mundo, así que la textura
 * se repite igual en todas las paredes, sin estirarse.
 */
function boxesGeometry(boxes: Box[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const b of boxes) {
    const g = new THREE.BoxGeometry(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
    g.translate((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
    const base = pos.length / 3;
    const P = g.getAttribute('position').array as Float32Array;
    const N = g.getAttribute('normal').array as Float32Array;
    for (let i = 0; i < P.length; i += 3) {
      const [x, y, z] = [P[i]!, P[i + 1]!, P[i + 2]!];
      const [nx, ny] = [Math.abs(N[i]!), Math.abs(N[i + 1]!)];
      // Proyección según hacia dónde mira la cara.
      const [u, v] = nx > 0.5 ? [z, y] : ny > 0.5 ? [x, z] : [x, y];
      uv.push(u / TEXTURE_METERS, v / TEXTURE_METERS);
    }
    pos.push(...P);
    nor.push(...N);
    for (const i of g.getIndex()!.array) idx.push(base + i);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

/** Parte las cajas que cruzan el límite del Laboratorio: [vestíbulo, laboratorio]. */
function splitAtLab(boxes: Box[], labX: number): [Box[], Box[]] {
  const LAB_X = labX;
  const left: Box[] = [];
  const right: Box[] = [];
  for (const b of boxes) {
    if (b[3] <= LAB_X) left.push(b);
    else if (b[0] >= LAB_X - 0.2) right.push(b);
    else {
      left.push([b[0], b[1], b[2], LAB_X - 0.2, b[4], b[5]]);
      right.push([LAB_X - 0.2, b[1], b[2], b[3], b[4], b[5]]);
    }
  }
  return [left, right];
}

/** Ancho de cada plancha metálica en metros (aspecto, no balance). */
const PLANK_WIDTH = 0.15;

/**
 * Disposición propia de las planchas de una ventana: una reja. Dos verticales
 * al fondo y tres horizontales cruzadas por delante, agrupadas en la franja
 * central, con huecos a los lados, arriba y abajo para ver quién viene.
 * El orden es el de reparación; los enemigos las arrancan al revés: primero las
 * horizontales de delante y al final las dos verticales.
 * place = [posición a lo ancho (-1 a 1), altura (0 a 1), giro, capa].
 */
const PLANK_LAYOUT: Array<{ place: [number, number, number, number]; length: (w: number, h: number) => number }> = [
  { place: [-0.36, 0.5, Math.PI / 2 - 0.07, 0], length: (_w, h) => h + 0.25 },
  { place: [0.4, 0.5, Math.PI / 2 + 0.05, 0], length: (_w, h) => h + 0.25 },
  { place: [0, 0.3, -0.05, 1], length: (w) => w + 0.3 },
  { place: [0, 0.72, 0.04, 1], length: (w) => w + 0.3 },
  { place: [0.03, 0.52, 0.13, 2], length: (w) => w + 0.2 },
];

const tmpMatrix = new THREE.Matrix4();
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const yAxis = new THREE.Vector3(0, 1, 0);
const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

export class GameView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.02, 80);
  readonly viewmodel: Viewmodel;
  /** Destello del disparo en el mundo: ilumina la sala un instante. */
  private readonly muzzleLight = new THREE.PointLight(0xffc68a, 0, 8, 2);
  private muzzleLightTime = 0;
  private readonly muzzle = new THREE.Vector3();
  private readonly enemyViews: EnemyViews;
  private readonly planks: THREE.InstancedMesh;
  private readonly plankMatrices: THREE.Matrix4[] = [];
  private readonly doors: THREE.Mesh[] = [];
  private readonly planksPerWindow: number;
  private readonly props: Props;
  private readonly effects: Effects;
  private time = 0;
  /** Cuánto se ha cerrado la niebla por La Jauría, de 0 a 1. */
  private packFog = 0;
  /** Balanceo de cámara al moverse y golpe al aterrizar (aspecto, no balance). */
  private bobPhase = 0;
  private bobAmount = 0;
  private landKick = 0;

  constructor(map: MapConfig, poolSize: number) {
    this.scene.background = new THREE.Color(COLORS.sky);
    this.scene.fog = new THREE.Fog(COLORS.sky, 6, FOG_FAR);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    // Noche en la montaña: luz de luna fría y poca luz ambiente. Dentro, bombillas cálidas.
    this.scene.add(new THREE.HemisphereLight(0x8fa6c4, 0x1c1814, 0.55));
    const moon = new THREE.DirectionalLight(0xa9c2e8, 0.9);
    moon.position.set(-6, 14, -8);
    this.scene.add(moon);
    const hall = new THREE.PointLight(0xffc98a, 14, 14, 1.6);
    hall.position.set(map.playerStart.position[0], 2.9, map.playerStart.position[2] - 1);
    this.scene.add(hall);

    // Suelo.
    this.scene.add(new THREE.Mesh(boxesGeometry([map.floor]), new THREE.MeshStandardMaterial({ color: COLORS.floor, roughness: 1 })));

    // Muros, alféizares y dinteles en una sola malla.
    const walls: Box[] = [...map.walls];
    for (const w of map.windows) {
      const [x0, z0, x1, z1] = w.opening;
      walls.push([x0, 0, z0, x1, map.sillHeight, z1], [x0, map.windowTop, z0, x1, map.wallHeight, z1]);
    }
    const [hallWalls, labWalls] = splitAtLab(walls, map.labArea[0]);
    this.scene.add(new THREE.Mesh(boxesGeometry(hallWalls), new THREE.MeshStandardMaterial({ color: COLORS.wall, roughness: 0.9 })));
    this.scene.add(new THREE.Mesh(boxesGeometry(labWalls), new THREE.MeshStandardMaterial({ map: labWallTexture(), roughness: 0.75, metalness: 0.15 })));
    // Suelo de baldosas del Laboratorio, apenas por encima del suelo general.
    this.scene.add(
      new THREE.Mesh(
        boxesGeometry([[map.labArea[0], 0, map.labArea[1], map.labArea[2], 0.004, map.labArea[3]]]),
        new THREE.MeshStandardMaterial({ map: labFloorTexture(), roughness: 0.85 }),
      ),
    );

    // Compuertas.
    const doorMat = new THREE.MeshStandardMaterial({ color: COLORS.door, roughness: 0.6, metalness: 0.2 });
    for (const d of map.doors) {
      const mesh = new THREE.Mesh(boxesGeometry([d.box]), doorMat);
      this.doors.push(mesh);
      this.scene.add(mesh);
    }

    // Taquillas de armería: panel en el muro con la silueta del arma.
    const lockerMat = new THREE.MeshStandardMaterial({ color: COLORS.locker, roughness: 0.5, emissive: COLORS.locker, emissiveIntensity: 0.25 });
    for (const b of map.wallBuys) {
      const group = new THREE.Group();
      group.add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 0.06), lockerMat));
      // El arma que se vende, colgada de lado en el panel con el cañón a la izquierda.
      const gun = buildWeapon(b.weapon).root;
      gun.scale.setScalar(1.5);
      gun.rotation.y = Math.PI / 2;
      gun.position.set(0.05, 0.02, 0.09);
      group.add(gun);
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

    // Enemigos: reserva fija de Vacíos animados.
    this.enemyViews = new EnemyViews(this.scene, poolSize);

    this.viewmodel = new Viewmodel(this.camera);
    this.scene.add(this.muzzleLight);
    this.props = new Props(this.scene, map);
    this.effects = new Effects(this.scene);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  render(renderer: THREE.WebGPURenderer): void {
    renderer.render(this.scene, this.camera);
  }

  /**
   * Prepara de antemano todo lo que se puede llegar a dibujar: materiales, sombreadores
   * y texturas de todo el mapa, los enemigos, las armas y los efectos. Sin esto, la
   * tarjeta gráfica los prepara la primera vez que entran en pantalla, y eso da tirones
   * (al entrar en el Laboratorio, al ver el primer lobo, al primer disparo).
   */
  async warmUp(renderer: THREE.WebGPURenderer): Promise<void> {
    const saved: Array<[THREE.Object3D, boolean, boolean]> = [];
    this.scene.traverse((o) => {
      saved.push([o, o.visible, o.frustumCulled]);
      o.visible = true;
      o.frustumCulled = false;
    });
    try {
      await renderer.compileAsync(this.scene, this.camera);
      // Un dibujo con todo a la vista sube también las texturas a la tarjeta.
      renderer.render(this.scene, this.camera);
    } finally {
      for (const [o, visible, culled] of saved) {
        o.visible = visible;
        o.frustumCulled = culled;
      }
    }
  }

  /** Cuánto se ha cerrado la vista al apuntar: 1 sin apuntar, menos de 1 apuntando. Para la sensibilidad del ratón. */
  get zoom(): number {
    return Math.tan(((this.camera.fov / 2) * Math.PI) / 180) / Math.tan(((BASE_FOV / 2) * Math.PI) / 180);
  }

  onEvent(ev: SimEvent, game: Game): void {
    if (ev.type === 'landed') this.landKick = Math.min(0.12, ev.speed * 0.018);
    this.viewmodel.onEvent(ev, game);
    if (ev.type === 'shot') {
      this.muzzleLightTime = 0.05;
      this.muzzleLight.color.setHex(ev.weapon === 'arco' ? 0x7fd0ff : 0xffc68a);
    } else if (ev.type === 'tracer') {
      // Las trazadoras salen de la boca del cañón que se ve en pantalla.
      this.camera.updateMatrixWorld();
      this.effects.tracer(this.viewmodel.muzzleWorld(this.camera, this.muzzle), ev.to);
    }
    this.enemyViews.onEvent(ev);
    this.effects.onEvent(ev, game);
  }

  /** Coloca todo según el estado, interpolando con `alpha` entre el paso anterior y el actual. */
  update(game: Game, alpha: number, yaw: number, pitch: number, frameSeconds: number): void {
    const p = game.player;
    const lerp = (a: number, b: number) => a + (b - a) * alpha;
    this.time += frameSeconds;
    const eye = p.downed ? DOWNED_EYE : EYE_HEIGHT;
    // Balanceo: sube y baja con los pasos y se inclina un poco a cada lado; más fuerte esprintando.
    const speed = Math.hypot(p.vel.x, p.vel.z);
    const target = p.grounded ? Math.min(1, speed / game.cfg.player.sprintSpeed) : 0;
    this.bobAmount += (target - this.bobAmount) * Math.min(1, frameSeconds * 8);
    this.bobPhase += frameSeconds * (p.downed ? 3 : 4 + speed * 1.3);
    const bobY = Math.sin(this.bobPhase * 2) * 0.035 * this.bobAmount;
    const roll = Math.sin(this.bobPhase) * 0.012 * this.bobAmount;
    this.landKick = Math.max(0, this.landKick - frameSeconds * 0.5);
    this.camera.position.set(
      lerp(p.prevPos.x, p.pos.x),
      lerp(p.prevPos.y, p.pos.y) + eye + bobY - this.landKick,
      lerp(p.prevPos.z, p.pos.z),
    );
    this.camera.rotation.set(pitch - this.landKick * 0.6, yaw, roll);

    // Durante La Jauría la niebla se cierra y se vuelve rojiza: se ve venir menos.
    const fog = this.scene.fog as THREE.Fog;
    const pack = game.round.special && game.round.phase === 'active' ? 1 : 0;
    this.packFog += (pack - this.packFog) * Math.min(1, frameSeconds * 0.8);
    fog.far = FOG_FAR + (PACK_FOG_FAR - FOG_FAR) * this.packFog;
    fog.color.setHex(COLORS.sky).lerp(PACK_FOG_COLOR, this.packFog);
    (this.scene.background as THREE.Color).copy(fog.color);

    this.enemyViews.update(game, alpha, frameSeconds);

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

    const slot = game.activeSlot();
    this.viewmodel.update(game, slot?.weapon ?? null, slot?.upgraded ?? false, frameSeconds, yaw, pitch);
    // Al apuntar se cierra el campo de visión, según la mira de cada arma.
    const aimZoom = slot ? (game.cfg.weapons[slot.weapon]?.aimZoom ?? 1) : 1;
    const fov = BASE_FOV * (1 - (1 - aimZoom) * this.viewmodel.aimAmount);
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.viewmodel.setZoom(aimZoom, fov);
    // Destello del disparo: la luz se coloca en la boca del cañón y se apaga enseguida.
    this.muzzleLightTime = Math.max(0, this.muzzleLightTime - frameSeconds);
    this.muzzleLight.intensity = this.muzzleLightTime > 0 ? MUZZLE_LIGHT : 0;
    if (this.muzzleLightTime > 0) {
      this.camera.updateMatrixWorld();
      this.muzzleLight.position.copy(this.viewmodel.muzzleWorld(this.camera, this.muzzle));
    }
    this.props.update(game, frameSeconds, this.time);
    this.effects.update(game, frameSeconds, this.time);
  }
}
