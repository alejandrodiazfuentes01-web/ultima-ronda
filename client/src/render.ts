/**
 * Dibuja la partida: las seis zonas de la Estación Aurora, cada una con su aspecto.
 * Solo lee el estado de la simulación e interpola entre el paso anterior y el actual (regla 2).
 *
 * Cada zona es un grupo con su suelo, sus muros y su techo en pocas mallas. Solo se
 * dibujan la zona del jugador y las que se ven desde ella por compuertas abiertas;
 * las demás quedan tras muros o compuertas cerradas y no cuestan nada.
 * Enemigos y planchas van en mallas de tamaño fijo (regla 5).
 */
import * as THREE from 'three/webgpu';
import { zoneAt, type Box, type MapConfig, type ZoneDef } from '../../shared/config';
import type { Game } from '../../shared/sim/game';
import { EYE_HEIGHT } from '../../shared/sim/physics';
import type { SimEvent } from '../../shared/sim/types';
import { EnemyViews } from './enemies';
import { Effects } from './effects';
import { Props } from './props';
import { concreteTexture, corrugatedTexture, labFloorTexture, labWallTexture, snowTexture } from './textures';
import { RadioTower, Snow } from './outdoors';
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

/**
 * Recorta una caja al rectángulo de una zona, o null si no lo toca. Los muros entre
 * dos zonas quedan partidos por la mitad: cada cara tiene el aspecto de su zona.
 */
function clipToZone(b: Box, r: [number, number, number, number]): Box | null {
  const x0 = Math.max(b[0], r[0]);
  const z0 = Math.max(b[2], r[1]);
  const x1 = Math.min(b[3], r[2]);
  const z1 = Math.min(b[5], r[3]);
  if (x1 - x0 < 0.001 || z1 - z0 < 0.001) return null;
  return [x0, b[1], z0, x1, b[4], z1];
}

/** Aspecto de cada zona: muros, suelo y techo (materiales sencillos: hay muchas luces por zona). */
function zoneLook(id: string): { wall: THREE.Material; floor: THREE.Material; ceiling: THREE.Material } {
  const lambert = (o: { map?: THREE.Texture; color?: number }) => new THREE.MeshLambertMaterial(o);
  const ceiling = lambert({ map: concreteTexture(70, 5) });
  switch (id) {
    case 'laboratorio':
      return { wall: new THREE.MeshStandardMaterial({ map: labWallTexture(), roughness: 0.75, metalness: 0.15 }), floor: lambert({ map: labFloorTexture() }), ceiling };
    case 'energia':
      return { wall: lambert({ map: labWallTexture(), color: 0x8a97b0 }), floor: lambert({ map: concreteTexture(88, 9), color: 0x9aa3b0 }), ceiling };
    case 'almacen':
      return { wall: lambert({ map: corrugatedTexture() }), floor: lambert({ map: concreteTexture(120, 13) }), ceiling };
    case 'patio':
      return { wall: lambert({ map: concreteTexture(132, 17), color: 0xc7ccd4 }), floor: lambert({ map: snowTexture() }), ceiling };
    case 'torre':
      return { wall: lambert({ map: concreteTexture(150, 21) }), floor: lambert({ map: concreteTexture(100, 25) }), ceiling };
    default:
      return { wall: lambert({ color: COLORS.wall }), floor: lambert({ map: concreteTexture(105, 29) }), ceiling };
  }
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
  /** Grupo de cada zona: se muestra solo si se puede ver desde donde está el jugador. */
  private readonly zoneGroups = new Map<string, THREE.Group>();
  private readonly map: MapConfig;
  private readonly snow: Snow[] = [];
  private readonly tower: RadioTower | null = null;
  private time = 0;
  /** Cuánto se ha cerrado la niebla por La Jauría, de 0 a 1. */
  private packFog = 0;
  /** Balanceo de cámara al moverse y golpe al aterrizar (aspecto, no balance). */
  private bobPhase = 0;
  private bobAmount = 0;
  private landKick = 0;

  constructor(map: MapConfig, poolSize: number) {
    this.map = map;
    this.scene.background = new THREE.Color(COLORS.sky);
    this.scene.fog = new THREE.Fog(COLORS.sky, 6, FOG_FAR);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    // Noche en la montaña: luz de luna fría y poca luz ambiente. Dentro, bombillas cálidas.
    this.scene.add(new THREE.HemisphereLight(0x8fa6c4, 0x1c1814, 0.55));
    const moon = new THREE.DirectionalLight(0xa9c2e8, 0.9);
    moon.position.set(-6, 14, -8);
    this.scene.add(moon);
    // Suelo de fuera: nieve en la oscuridad.
    this.scene.add(new THREE.Mesh(boxesGeometry([map.floor]), new THREE.MeshLambertMaterial({ map: snowTexture(), color: 0x6c7480 })));

    // Muros, alféizares y dinteles, repartidos por zonas.
    const walls: Box[] = [...map.walls];
    for (const w of map.windows) {
      const [x0, z0, x1, z1] = w.opening;
      walls.push([x0, 0, z0, x1, map.sillHeight, z1], [x0, map.windowTop, z0, x1, map.wallHeight, z1]);
    }
    // Los bordes del mapa se amplían un poco para que los muros exteriores caigan dentro de su zona.
    const minX = Math.min(...map.zones.map((z) => z.area[0]));
    const minZ = Math.min(...map.zones.map((z) => z.area[1]));
    const maxX = Math.max(...map.zones.map((z) => z.area[2]));
    const maxZ = Math.max(...map.zones.map((z) => z.area[3]));
    const grow = (v: number, edge: number, d: number) => (v === edge ? v + d : v);
    for (const zone of map.zones) {
      const [x0, z0, x1, z1] = zone.area;
      const clip: [number, number, number, number] = [grow(x0, minX, -1), grow(z0, minZ, -1), grow(x1, maxX, 1), grow(z1, maxZ, 1)];
      const look = zoneLook(zone.id);
      const group = new THREE.Group();
      group.name = zone.id;
      const mine = walls.map((b) => clipToZone(b, clip)).filter((b): b is Box => b !== null);
      group.add(new THREE.Mesh(boxesGeometry(mine), look.wall));
      group.add(new THREE.Mesh(boxesGeometry([[x0, 0, z0, x1, 0.004, z1]]), look.floor));
      if (zone.roofed) group.add(new THREE.Mesh(boxesGeometry([[x0, map.wallHeight, z0, x1, map.wallHeight + 0.15, z1]]), look.ceiling));
      this.zoneGroups.set(zone.id, group);
      this.scene.add(group);
    }

    // Al aire libre: nieve en las zonas sin techo y la torre de radio, que se ve por encima de los muros.
    for (const zone of map.zones) {
      if (zone.roofed) continue;
      const snow = new Snow(zone.area);
      this.snow.push(snow);
      this.zoneGroups.get(zone.id)!.add(snow.mesh);
    }
    if (map.radioTower) {
      this.tower = new RadioTower(map);
      this.scene.add(this.tower.root);
    }

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
      this.attach(group, b.anchor[0], b.anchor[1]);
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
    this.props = new Props(this.scene, map, (o, x, z) => this.attach(o, x, z));
    this.effects = new Effects(this.scene);
  }

  /** Mete un objeto en el grupo de la zona donde está; si no cae en ninguna, en la escena. */
  private attach(o: THREE.Object3D, x: number, z: number): void {
    const zone = zoneAt(this.map, x, z);
    (zone ? this.zoneGroups.get(zone.id) : undefined)?.add(o) ?? this.scene.add(o);
  }

  /**
   * Zonas que se pueden ver: la del jugador y las que se ven por compuertas abiertas,
   * hasta dos zonas más allá. Fuera del edificio, todas.
   */
  private visibleZones(game: Game, here: ZoneDef | null): Set<string> | null {
    if (!here) return null;
    const seen = new Set<string>([here.id]);
    let frontier = [here.id];
    for (let depth = 0; depth < 2; depth++) {
      const next: string[] = [];
      this.map.doors.forEach((d, i) => {
        if (!game.doors[i]!.open) return;
        const [a, b] = d.connects;
        for (const [from, to] of [
          [a, b],
          [b, a],
        ] as const) {
          if (frontier.includes(from) && !seen.has(to)) {
            seen.add(to);
            next.push(to);
          }
        }
      });
      frontier = next;
    }
    return seen;
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

    // Solo se dibujan las zonas que se pueden ver.
    const visible = this.visibleZones(game, zoneAt(this.map, this.camera.position.x, this.camera.position.z));
    for (const [id, group] of this.zoneGroups) group.visible = !visible || visible.has(id);
    for (const snow of this.snow) snow.update(frameSeconds, this.time, yaw);
    this.tower?.update(this.time);

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
