/**
 * Arma en primera persona, con manos sencillas y animada por código: cadera y mira,
 * balanceo al andar y al girar, retroceso, recarga (el cargador sale y entra),
 * corredera, bombeo de la escopeta, fogonazo y casquillos.
 *
 * El arma va pegada a la cámara del mundo pero encogida hacia el ojo (VM_SCALE): en
 * pantalla se ve igual, y como queda más cerca que cualquier pared, nunca se mete en
 * ellas. Se estira un poco a lo ancho y a lo alto para verse como con un campo de
 * visión propio (VM_FOV), que no cambia al cerrar la vista del mundo al apuntar.
 * Todo se crea al arrancar (regla 5); durante la partida solo se mueve y se muestra.
 */
import * as THREE from 'three/webgpu';
import type { Game } from '../../shared/sim/game';
import type { SimEvent } from '../../shared/sim/types';
import { buildHand, buildWeapon, WEAPON_IDS, type WeaponModel } from './weapons/build';
import type { V3 } from './weapons/defs';
import { flashTexture } from './textures';

/** Campo de visión con el que se ve el arma (aspecto, no balance). */
const VM_FOV = 54;
/** El arma se encoge hacia el ojo: así nada del mundo queda más cerca que ella. */
const VM_SCALE = 0.3;
/** Retroceso visual del modelo, por nivel de weapons.json: hacia atrás (m) y cabeceo (rad). */
const KICK: Record<string, [number, number]> = { none: [0.004, 0.01], low: [0.012, 0.025], medium: [0.02, 0.045], high: [0.03, 0.07], veryHigh: [0.05, 0.12] };
/** Tamaño del fogonazo por arma. */
const FLASH_SIZE: Record<string, number> = { m1911: 0.7, m870: 1.4, smg5: 0.8, v45: 0.75, ak74: 1.1, m16: 1, mk17: 1.25, m249: 1.15, svd: 1.5, arco: 1 };
const CASING_POOL = 24;
const CASING_LIFE = 0.55;
/** Gravedad de los casquillos, en el espacio encogido del arma. */
const GRAVITY = 2.6;
/** Paso máximo del muelle del retroceso, en segundos. */
const SPRING_STEP = 1 / 240;

const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const zAxis = new THREE.Vector3(0, 0, 1);
const hiddenM = new THREE.Matrix4().makeScale(0, 0, 0);

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
/** Tramo de una animación: 0 antes de `a`, 1 después de `b`, suave entre medias. */
const span = (t: number, a: number, b: number) => smooth(clamp01((t - a) / (b - a)));

function v3(a: V3): THREE.Vector3 {
  return new THREE.Vector3(a[0], a[1], a[2]);
}

interface Gun {
  model: WeaponModel;
  /** Centro del cargador en el arma, para llevar ahí la mano al recargar. */
  magCenter: THREE.Vector3;
}

export class Viewmodel {
  /** Espacio del arma: pegado a la cámara, encogido y estirado (ver arriba). */
  private readonly space = new THREE.Group();
  /** Pose del arma respecto al ojo. Lleva dentro el arma, las manos y el fogonazo. */
  private readonly holder = new THREE.Group();
  private readonly guns = new Map<string, Gun>();
  private readonly rightHand = buildHand('grip', 'right');
  private readonly leftUnder = buildHand('under', 'left');
  private readonly leftCup = buildHand('cup', 'left');
  private readonly flash = new THREE.Group();
  private readonly flashMat: THREE.MeshBasicMaterial;
  private readonly casings: THREE.InstancedMesh;
  private readonly casingPos = new Float32Array(CASING_POOL * 3);
  private readonly casingVel = new Float32Array(CASING_POOL * 3);
  private readonly casingLife = new Float32Array(CASING_POOL);
  private readonly casingSize = new Float32Array(CASING_POOL);
  private nextCasing = 0;

  private shown: string | null = null;
  private current: Gun | null = null;
  private time = 0;
  private aim = 0;
  private kickBack = 0;
  private kickPitch = 0;
  private kickVel = 0;
  private kickPitchVel = 0;
  private flashTime = 0;
  private sinceShot = 99;
  /** Ya ha salido el cartucho del bombeo tras el último disparo. */
  private pumpEjected = true;
  private bobPhase = 0;
  private bobAmount = 0;
  private swayX = 0;
  private swayY = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private sprintPose = 0;
  private meleeT = 0;
  private shellBump = 0;
  /** Si el arma tiene la mira telescópica pegada al ojo: la interfaz dibuja la mira y el arma se oculta. */
  scoped = false;

  constructor(camera: THREE.Camera) {
    camera.add(this.space);
    this.space.add(this.holder);
    // Luz suave pegada al jugador, de alcance muy corto: el arma se ve aunque esté en un rincón oscuro.
    const fill = new THREE.PointLight(0xf4f0ea, 0.75, 0.6, 0);
    fill.position.set(-0.05, 0.08, 0.02);
    camera.add(fill);

    for (const id of WEAPON_IDS) {
      for (const upgraded of [false, true]) {
        const model = buildWeapon(id, upgraded);
        model.root.visible = false;
        const box = new THREE.Box3().setFromObject(model.parts.mag);
        const magCenter = box.isEmpty() ? v3(model.def.grip) : box.getCenter(new THREE.Vector3());
        this.guns.set(`${id}:${upgraded}`, { model, magCenter });
        this.holder.add(model.root);
      }
    }
    this.holder.add(this.rightHand, this.leftUnder, this.leftCup);

    // Fogonazo: una estrella de frente y dos planos cruzados a lo largo del cañón, con mezcla aditiva.
    this.flashMat = new THREE.MeshBasicMaterial({
      map: flashTexture(),
      color: 0xffd7a0,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.11), this.flashMat);
    const side1 = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.16), this.flashMat);
    side1.rotation.x = Math.PI / 2;
    side1.position.z = -0.06;
    const side2 = side1.clone();
    side2.rotation.y = Math.PI / 2;
    this.flash.add(front, side1, side2);
    this.flash.visible = false;
    this.holder.add(this.flash);

    // Casquillos: una malla instanciada; cada uno con su tamaño y color.
    this.casings = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.0028, 0.0028, 0.012, 6).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.8 }),
      CASING_POOL,
    );
    for (let i = 0; i < CASING_POOL; i++) {
      this.casings.setMatrixAt(i, hiddenM);
      this.casings.setColorAt(i, new THREE.Color(0xc89b3c));
    }
    this.casings.frustumCulled = false;
    this.space.add(this.casings);
  }

  onEvent(ev: SimEvent, game: Game): void {
    if (ev.type === 'shot') {
      const w = game.cfg.weapons[ev.weapon];
      const [back, pitch] = KICK[w?.recoil ?? 'none'] ?? KICK.none!;
      const aimFactor = 1 - this.aim * 0.6;
      this.kickVel += back * 30 * aimFactor;
      this.kickPitchVel += pitch * 30 * aimFactor;
      this.flashTime = 0.045;
      this.sinceShot = 0;
      this.pumpEjected = false;
      this.flash.scale.setScalar((FLASH_SIZE[ev.weapon] ?? 1) * (0.8 + Math.random() * 0.45));
      this.flash.rotation.z = Math.random() * Math.PI;
      this.flashMat.color.setHex(ev.weapon === 'arco' ? 0x8fdcff : ev.upgraded ? 0xffa060 : 0xffd7a0);
      this.ejectCasing();
    } else if (ev.type === 'melee') {
      this.meleeT = 1;
    } else if (ev.type === 'shellLoaded') {
      this.shellBump = 1;
    }
  }

  private ejectCasing(): void {
    const gun = this.current;
    if (!gun || gun.model.def.casing === 'none' || gun.model.def.casing === 'shell') return;
    this.spawnCasing(gun, gun.model.def.casing === 'rifle' ? 1.35 : 1, 0xc89b3c);
  }

  /** Suelta un casquillo (o un cartucho de escopeta) por la ventana de expulsión. */
  private spawnCasing(gun: Gun, size: number, color: number): void {
    const i = this.nextCasing;
    this.nextCasing = (this.nextCasing + 1) % CASING_POOL;
    tmpV.set(...gun.model.def.eject);
    this.holder.localToWorld(tmpV);
    this.space.worldToLocal(tmpV);
    this.casingPos[i * 3] = tmpV.x;
    this.casingPos[i * 3 + 1] = tmpV.y;
    this.casingPos[i * 3 + 2] = tmpV.z;
    // Salen a la derecha y hacia arriba, y caen fuera de la pantalla.
    this.casingVel[i * 3] = 0.35 + Math.random() * 0.2;
    this.casingVel[i * 3 + 1] = 0.3 + Math.random() * 0.15;
    this.casingVel[i * 3 + 2] = -0.02 + Math.random() * 0.06;
    this.casingLife[i] = CASING_LIFE;
    this.casingSize[i] = size;
    this.casings.setColorAt(i, tmpColor.setHex(color));
    if (this.casings.instanceColor) this.casings.instanceColor.needsUpdate = true;
  }

  /**
   * Coloca el arma. `yaw` y `pitch` son la mirada del jugador, para que el arma
   * se retrase un poco al girar.
   */
  update(game: Game, weapon: string | null, upgraded: boolean, dt: number, yaw: number, pitch: number): void {
    this.time += dt;
    const key = weapon ? `${weapon}:${upgraded}` : null;
    if (key !== this.shown) {
      for (const [id, g] of this.guns) g.model.root.visible = id === key;
      this.shown = key;
      this.current = key ? (this.guns.get(key) ?? null) : null;
    }
    const gun = this.current;
    this.holder.visible = !!gun;
    if (!gun) return;
    const def = gun.model.def;
    const p = game.player;
    const cfg = weapon ? game.cfg.weapons[weapon] : undefined;

    // Mira: se sigue el valor de la simulación, suavizado entre pasos.
    this.aim += (p.aim - this.aim) * Math.min(1, dt * 30);
    const aim = smooth(this.aim);
    this.scoped = cfg?.sight === 'scope' && this.aim > 0.92;

    // Retroceso del modelo: muelle amortiguado, en pasos cortos para que sea estable
    // aunque un fotograma tarde mucho.
    const k = 260;
    const damp = 24;
    const steps = Math.ceil(dt / SPRING_STEP);
    const h = dt / Math.max(1, steps);
    for (let i = 0; i < steps; i++) {
      this.kickVel += (-k * this.kickBack - damp * this.kickVel) * h;
      this.kickBack += this.kickVel * h;
      this.kickPitchVel += (-k * this.kickPitch - damp * this.kickPitchVel) * h;
      this.kickPitch += this.kickPitchVel * h;
    }

    // Retraso al girar la vista, menor apuntando.
    let dyaw = yaw - this.lastYaw;
    if (dyaw > Math.PI) dyaw -= Math.PI * 2;
    if (dyaw < -Math.PI) dyaw += Math.PI * 2;
    const dpitch = pitch - this.lastPitch;
    this.lastYaw = yaw;
    this.lastPitch = pitch;
    const swayScale = 1 - aim * 0.8;
    this.swayX = Math.max(-0.05, Math.min(0.05, this.swayX + dyaw * 0.35 * swayScale));
    this.swayY = Math.max(-0.05, Math.min(0.05, this.swayY + dpitch * 0.35 * swayScale));
    const back = Math.min(1, dt * 9);
    this.swayX -= this.swayX * back;
    this.swayY -= this.swayY * back;

    // Balanceo al andar.
    const speed = Math.hypot(p.vel.x, p.vel.z);
    const bobTarget = p.grounded ? Math.min(1, speed / game.cfg.player.sprintSpeed) : 0;
    this.bobAmount += (bobTarget - this.bobAmount) * Math.min(1, dt * 8);
    this.bobPhase += dt * (4 + speed * 1.3);
    const bob = this.bobAmount * (1 - aim * 0.85);
    // Respiración en reposo: el arma nunca está quieta del todo.
    const breathe = Math.sin(this.time * 1.6) * 0.0018 * (1 - aim * 0.7);

    // Esprintando, el arma baja y se ladea.
    const poseTarget = p.sprinting || p.sprintFireDelay > 0 ? 1 : 0;
    this.sprintPose += (poseTarget - this.sprintPose) * Math.min(1, dt * 10);
    const sprint = smooth(this.sprintPose);

    // Cambio de arma: baja y vuelve a subir.
    const sw = game.cfg.player.weaponSwitchSeconds;
    const lower = p.switchTimer > 0 && sw > 0 ? smooth(p.switchTimer / sw) * 0.3 : 0;

    // Recarga.
    let reloadT = -1;
    if (p.reloadTimer > 0 && cfg && !p.downed && cfg.reloadMode === 'magazine') reloadT = 1 - p.reloadTimer / game.reloadSecondsOf(cfg);
    const shellReload = p.reloadTimer > 0 && cfg?.reloadMode === 'shell';
    const tiltIn = reloadT >= 0 ? span(reloadT, 0, 0.12) * (1 - span(reloadT, 0.86, 1)) : shellReload ? 1 : 0;
    this.shellBump = Math.max(0, this.shellBump - dt * 5);

    // Cuerpo a cuerpo: un golpe rápido con el arma.
    this.meleeT = Math.max(0, this.meleeT - dt / 0.35);
    const melee = Math.sin(Math.PI * (1 - this.meleeT)) * (this.meleeT > 0 ? 1 : 0);

    // Pose: de la cadera a la mira.
    const hip = def.hip;
    const adsX = 0;
    const adsY = -def.sightY;
    const adsZ = -def.eyeRelief - def.sightZ;
    const x = hip[0] + (adsX - hip[0]) * aim;
    const y = hip[1] + (adsY - hip[1]) * aim;
    const z = hip[2] + (adsZ - hip[2]) * aim;
    this.holder.position.set(
      x + Math.sin(this.bobPhase) * 0.012 * bob - this.swayX * 0.6 + sprint * 0.02 - melee * 0.05,
      y - Math.abs(Math.cos(this.bobPhase)) * 0.012 * bob + this.swayY * 0.6 + breathe - sprint * 0.07 - lower - tiltIn * 0.02 - this.shellBump * 0.006,
      z + this.kickBack + sprint * 0.03 - melee * 0.08,
    );
    this.holder.rotation.set(
      this.kickPitch + this.swayY * 1.5 - sprint * 0.45 + lower * 1.4 + tiltIn * 0.18 - melee * 0.3,
      -this.swayX * 1.5 + sprint * 0.6 + melee * 0.5 + (1 - aim) * 0.035,
      this.swayX * 2 + sprint * 0.35 - tiltIn * 0.45 + melee * 0.3,
    );

    this.animateParts(game, gun, reloadT, shellReload);

    // Fogonazo.
    this.flashTime -= dt;
    this.flash.visible = this.flashTime > 0 && !this.scoped;
    this.flash.position.set(def.muzzle[0], def.muzzle[1], def.muzzle[2] - 0.02);
    this.sinceShot += dt;

    this.updateCasings(dt);

    // Con la mira telescópica en el ojo, el arma se esconde y la interfaz dibuja la mira.
    this.holder.visible = !this.scoped;
  }

  /** Cargador, corredera, bombeo y mano izquierda. */
  private animateParts(game: Game, gun: Gun, reloadT: number, shellReload: boolean): void {
    const def = gun.model.def;
    const parts = gun.model.parts;
    const p = game.player;
    const slot = game.activeSlot();

    // Cargador: sale hacia abajo, desaparece y entra uno nuevo.
    const out = v3(def.magOut);
    let magOffset = 0;
    let magVisible = true;
    if (reloadT >= 0) {
      if (reloadT < 0.3) magOffset = span(reloadT, 0.12, 0.3);
      else if (reloadT < 0.45) magVisible = false;
      else magOffset = 1 - span(reloadT, 0.45, 0.65);
    }
    parts.mag.position.copy(out).multiplyScalar(magOffset * 1.6);
    parts.mag.visible = magVisible;

    // Corredera o palanca: atrás al disparar; en la recarga, se tira de ella al final.
    let slide = this.sinceShot < 0.07 ? Math.sin((this.sinceShot / 0.07) * Math.PI) : 0;
    if (reloadT >= 0) slide = Math.max(slide, Math.sin(span(reloadT, 0.76, 0.92) * Math.PI));
    // La pistola se queda abierta con el cargador vacío.
    if (def.casing === 'pistol' && def.slideTravel > 0 && slot && slot.mag === 0 && reloadT < 0) slide = 1;
    parts.slide.position.z = slide * def.slideTravel;

    // Bombeo de la escopeta tras cada disparo.
    let pump = 0;
    if (def.pumpTravel > 0 && !shellReload) {
      const s = this.sinceShot;
      if (s > 0.12 && s < 0.62) pump = Math.sin(((s - 0.12) / 0.5) * Math.PI);
      if (s > 0.3 && !this.pumpEjected) {
        this.pumpEjected = true;
        this.spawnCasing(gun, 2.4, 0xa3271f);
      }
    }
    parts.pump.position.z = pump * def.pumpTravel;

    // Mano derecha en la empuñadura.
    this.place(this.rightHand, v3(def.grip), new THREE.Vector3(0.3, -1, 0.55));

    // Mano izquierda: sujeta delante; en la recarga va al cargador y baja con él.
    const cup = def.supportPose === 'cup';
    const left = cup ? this.leftCup : this.leftUnder;
    this.leftCup.visible = cup;
    this.leftUnder.visible = !cup;
    const support = v3(def.support);
    if (def.pumpTravel > 0) support.z += pump * def.pumpTravel;
    let hand = support;
    if (reloadT >= 0) {
      const magAt = gun.magCenter.clone().add(new THREE.Vector3(0, -0.03, 0));
      const away = magAt.clone().addScaledVector(out, 2.6);
      if (reloadT < 0.12) hand = support.lerp(magAt, span(reloadT, 0, 0.12));
      else if (reloadT < 0.3) hand = magAt.clone().addScaledVector(out, span(reloadT, 0.12, 0.3) * 1.6);
      else if (reloadT < 0.45) hand = away;
      else if (reloadT < 0.65) hand = away.lerp(magAt, span(reloadT, 0.45, 0.65));
      else hand = magAt.lerp(support, span(reloadT, 0.65, 0.8));
    } else if (shellReload) {
      // Escopeta: la mano mete cartuchos por debajo del cajón.
      hand = new THREE.Vector3(0, -0.06 + this.shellBump * 0.025, 0.0 - this.shellBump * 0.02);
    }
    this.place(left, hand, cup ? new THREE.Vector3(-0.45, -1, 0.5) : new THREE.Vector3(-0.4, -1, 0.45));
  }

  /** Pone una mano en un punto del arma con el antebrazo hacia `dir`. */
  private place(hand: THREE.Object3D, at: THREE.Vector3, dir: THREE.Vector3): void {
    hand.position.copy(at);
    hand.quaternion.setFromUnitVectors(zAxis, dir.normalize());
  }

  private updateCasings(dt: number): void {
    let any = false;
    for (let i = 0; i < CASING_POOL; i++) {
      if (this.casingLife[i]! <= 0) continue;
      any = true;
      this.casingLife[i] = this.casingLife[i]! - dt;
      if (this.casingLife[i]! <= 0) {
        this.casings.setMatrixAt(i, hiddenM);
        continue;
      }
      this.casingVel[i * 3 + 1] = this.casingVel[i * 3 + 1]! - GRAVITY * dt;
      for (let c = 0; c < 3; c++) this.casingPos[i * 3 + c] = this.casingPos[i * 3 + c]! + this.casingVel[i * 3 + c]! * dt;
      const age = CASING_LIFE - this.casingLife[i]!;
      tmpQ.setFromEuler(new THREE.Euler(age * 20 + i, age * 14, 0));
      const s = this.casingSize[i]!;
      tmpS.set(s, s, s);
      tmpM.compose(tmpV.set(this.casingPos[i * 3]!, this.casingPos[i * 3 + 1]!, this.casingPos[i * 3 + 2]!), tmpQ, tmpS);
      this.casings.setMatrixAt(i, tmpM);
    }
    if (any) this.casings.instanceMatrix.needsUpdate = true;
  }

  /**
   * Boca del cañón en el mundo, a tamaño real (para el destello y las trazadoras).
   * El arma está encogida hacia el ojo; aquí se deshace ese encogimiento.
   */
  muzzleWorld(camera: THREE.Camera, out: THREE.Vector3): THREE.Vector3 {
    const gun = this.current;
    if (!gun) out.set(0.1, -0.1, -0.5);
    else {
      out.set(...gun.model.def.muzzle);
      this.holder.localToWorld(out);
      camera.worldToLocal(out);
      out.divideScalar(VM_SCALE);
    }
    return camera.localToWorld(out);
  }

  /**
   * Ajusta el estirado del arma al campo de visión del mundo (`worldFov`), para que se
   * vea como con el suyo propio, que solo se cierra un poco al apuntar.
   */
  setZoom(aimZoom: number, worldFov: number): void {
    const vmFov = VM_FOV * (1 - (1 - Math.max(aimZoom, 0.75)) * smooth(this.aim));
    const k = Math.tan((worldFov * Math.PI) / 360) / Math.tan((vmFov * Math.PI) / 360);
    this.space.scale.set(VM_SCALE * k, VM_SCALE * k, VM_SCALE);
  }

  get aimAmount(): number {
    return smooth(this.aim);
  }
}

const tmpColor = new THREE.Color();
