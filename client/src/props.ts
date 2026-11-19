/**
 * Objetos del mapa y su estado visible: estaciones de suero, panel de energía,
 * El Contenedor, La Forja, el decorado y las luces que se encienden con la energía.
 * Todo se crea al arrancar; durante la partida solo se mueve, se muestra o se oculta.
 */
import * as THREE from 'three/webgpu';
import type { Box, Fixture, MapConfig } from '../../shared/config';
import type { Game } from '../../shared/sim/game';
import { placeModel } from './models';
import { WEAPON_IDS, buildWeapon } from './weapons/build';

/** Color del brillo de cada suero. */
const PERK_GLOW: Record<string, number> = { coraza: 0xffa040, segundoAliento: 0x4fe0ff, pulso: 0x7cff6a, dobleFilo: 0xff5a5a };
/** Sueros cuya estación reutiliza el modelo de otra: se tiñe con su color para distinguirla. */
const PERK_TINTED = new Set(['pulso', 'dobleFilo']);

/** Tiñe una copia del modelo con un color, sin tocar los materiales compartidos. */
function tint(model: THREE.Object3D, color: number): THREE.Object3D {
  const c = new THREE.Color(color);
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = (mesh.material as THREE.MeshStandardMaterial).clone();
    m.color.lerp(c, 0.45);
    m.emissive = c.clone();
    m.emissiveIntensity = 0.12;
    mesh.material = m;
  });
  return model;
}
const FALLBACK = 0x6d757e;
/** Luz de emergencia de las zonas sin energía, y la de después. */
const EMERGENCY = 0xff2a1a;
const EMERGENCY_INTENSITY = 6;
const POWERED = 0xfff1d6;
const POWERED_INTENSITY = 22;
/** Cada cuánto cambia el arma mientras gira El Contenedor. */
const SPIN_SWAP_SECONDS = 0.12;

/** Expositor flotante: todas las armas, normales y mejoradas, ya creadas; se enseña una. */
class WeaponDisplay {
  readonly root = new THREE.Group();
  private readonly guns = new Map<string, THREE.Group>();
  private shown: string | null = null;

  constructor(scene: THREE.Scene) {
    for (const id of WEAPON_IDS) {
      for (const upgraded of [false, true]) {
        const g = buildWeapon(id, upgraded).root;
        g.scale.setScalar(1.6);
        g.visible = false;
        this.guns.set(`${id}:${upgraded}`, g);
        this.root.add(g);
      }
    }
    scene.add(this.root);
  }

  show(id: string | null, upgraded = false): void {
    const key = id ? `${id}:${upgraded}` : null;
    if (key === this.shown) return;
    for (const [k, g] of this.guns) g.visible = k === key;
    this.shown = key;
  }
}

function anchorTop(f: Fixture): THREE.Vector3 {
  const [x0, , z0, x1, y1, z1] = f.box;
  return new THREE.Vector3((x0 + x1) / 2, y1, (z0 + z1) / 2);
}

export class Props {
  private readonly boxModels: THREE.Object3D[] = [];
  private readonly boxDisplay: WeaponDisplay;
  private readonly forjaDisplay: WeaponDisplay;
  private readonly forjaGlow: THREE.Mesh;
  private readonly perkGlows: Array<{ perk: string; mesh: THREE.Mesh }> = [];
  private readonly powerLamp: THREE.Mesh;
  /** Luces de las zonas que dependen de la energía: emergencia roja hasta que llega. */
  private readonly zoneLights: THREE.PointLight[] = [];
  private readonly map: MapConfig;
  private spinPick = 0;
  private spinTimer = 0;
  private powerShown = false;

  /**
   * `attach` mete cada objeto en el grupo de su zona (para no dibujar las zonas que no se ven).
   * Las luces van siempre en la escena: quitarlas o ponerlas obligaría a rehacer los sombreadores.
   */
  constructor(scene: THREE.Scene, map: MapConfig, attach: (o: THREE.Object3D, x: number, z: number) => void) {
    this.map = map;
    const at = (o: THREE.Object3D, box: Box) => attach(o, (box[0] + box[3]) / 2, (box[2] + box[5]) / 2);
    for (const d of map.decor) at(placeModel(d.model, d.box, d.facing, FALLBACK), d.box);
    const ps = map.powerSwitch;
    at(placeModel(ps.model, ps.box, ps.facing, 0x8a8f2a), ps.box);
    for (const st of map.perkStations) {
      const m = placeModel(st.model, st.box, st.facing, PERK_GLOW[st.perk] ?? FALLBACK);
      at(PERK_TINTED.has(st.perk) ? tint(m, PERK_GLOW[st.perk]!) : m, st.box);
    }
    at(placeModel(map.forja.model, map.forja.box, map.forja.facing, 0x5a3a2a), map.forja.box);
    for (const spot of map.contenedorSpots) {
      const m = placeModel(spot.model, spot.box, spot.facing, 0x56603a);
      this.boxModels.push(m);
      at(m, spot.box);
    }

    // Brillo de cada estación de suero: una esfera que se enciende cuando se puede comprar.
    for (const st of map.perkStations) {
      const color = PERK_GLOW[st.perk] ?? 0xffffff;
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color }));
      const [x0, , z0, x1, y1, z1] = st.box;
      mesh.position.set((x0 + x1) / 2 + st.facing[0] * ((x1 - x0) / 2 + 0.05), y1 + 0.1, (z0 + z1) / 2 + st.facing[1] * ((z1 - z0) / 2 + 0.05));
      this.perkGlows.push({ perk: st.perk, mesh });
      at(mesh, st.box);
    }

    // Piloto del panel de energía: rojo apagado, verde encendido.
    this.powerLamp = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff3020 }));
    this.powerLamp.position.copy(anchorTop(ps)).add(new THREE.Vector3(0, 0.15, 0));
    at(this.powerLamp, ps.box);

    // La Forja brilla mientras trabaja.
    this.forjaGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xff6a1a, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.forjaGlow.position.copy(anchorTop(map.forja)).add(new THREE.Vector3(map.forja.facing[0] * 0.4, -0.5, map.forja.facing[1] * 0.4));
    at(this.forjaGlow, map.forja.box);

    this.boxDisplay = new WeaponDisplay(scene);
    this.forjaDisplay = new WeaponDisplay(scene);

    // Luces de cada zona. La de inicio, cálida siempre; las demás, de emergencia roja hasta que llega la energía.
    for (const zone of map.zones) {
      for (const [x, z] of zone.lights) {
        const l = zone.startsOpen ? new THREE.PointLight(0xffc98a, 14, 14, 1.6) : new THREE.PointLight(EMERGENCY, EMERGENCY_INTENSITY, 14, 1.6);
        l.position.set(x, zone.roofed ? 2.9 : 4.5, z);
        if (!zone.startsOpen) this.zoneLights.push(l);
        scene.add(l);
      }
    }
  }

  update(game: Game, dt: number, time: number): void {
    const map = this.map;

    // Energía.
    if (game.power !== this.powerShown) {
      this.powerShown = game.power;
      (this.powerLamp.material as THREE.MeshBasicMaterial).color.setHex(game.power ? 0x40ff60 : 0xff3020);
      for (const l of this.zoneLights) {
        l.color.setHex(game.power ? POWERED : EMERGENCY);
        l.intensity = game.power ? POWERED_INTENSITY : EMERGENCY_INTENSITY;
      }
    }

    // Sueros: brillan si se pueden comprar ahora.
    for (const g of this.perkGlows) {
      const perk = game.cfg.perks.perks[g.perk];
      const on = !!perk && game.perkStationOn(g.perk) && (!perk.needsPower || game.power) && !game.player.perks.includes(g.perk);
      g.mesh.visible = on;
      if (on) g.mesh.scale.setScalar(1 + Math.sin(time * 3) * 0.15);
    }

    // El Contenedor: visible en su hueco salvo cuando se traslada.
    const box = game.contenedor;
    this.boxModels.forEach((m, i) => {
      m.visible = i === box.spot && box.phase !== 'moving';
    });
    const spot = map.contenedorSpots[box.spot]!;
    const top = anchorTop(spot);
    if (box.phase === 'spinning') {
      this.spinTimer -= dt;
      if (this.spinTimer <= 0) {
        this.spinTimer = SPIN_SWAP_SECONDS;
        this.spinPick = (this.spinPick + 1 + Math.floor(Math.random() * 3)) % game.cfg.contenedor.pool.length;
      }
      this.boxDisplay.show(game.cfg.contenedor.pool[this.spinPick] ?? null);
    } else if (box.phase === 'offering') {
      this.boxDisplay.show(box.weapon);
    } else {
      this.boxDisplay.show(null);
    }
    const rise = box.phase === 'spinning' ? Math.min(1, (game.cfg.contenedor.spinSeconds - box.timer) / 0.6) : 1;
    this.boxDisplay.root.position.set(top.x, top.y + 0.15 + rise * 0.35 + Math.sin(time * 2) * 0.03, top.z);
    this.boxDisplay.root.rotation.y = time * 1.5;

    // La Forja.
    const f = game.forja;
    const glow = this.forjaGlow.material as THREE.MeshBasicMaterial;
    glow.opacity = f.phase === 'working' ? 0.35 + Math.sin(time * 14) * 0.2 : f.phase === 'ready' ? 0.25 : 0;
    this.forjaDisplay.show(f.phase === 'ready' && f.slot ? f.slot.weapon : null, true);
    const ft = anchorTop(map.forja);
    this.forjaDisplay.root.position.set(ft.x + map.forja.facing[0] * 0.6, ft.y + 0.2 + Math.sin(time * 2) * 0.03, ft.z + map.forja.facing[1] * 0.6);
    this.forjaDisplay.root.rotation.y = time * 1.2;
  }
}
