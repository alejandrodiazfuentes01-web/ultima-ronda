/**
 * Objetos del mapa y su estado visible: estaciones de suero, panel de energía,
 * El Contenedor, La Forja, el decorado y las luces que se encienden con la energía.
 * Todo se crea al arrancar; durante la partida solo se mueve, se muestra o se oculta.
 */
import * as THREE from 'three/webgpu';
import type { Fixture, MapConfig } from '../../shared/config';
import type { Game } from '../../shared/sim/game';
import { placeModel } from './models';
import { WEAPON_SHAPES, buildWeapon } from './weaponShapes';

/** Color del brillo de cada suero. */
const PERK_GLOW: Record<string, number> = { coraza: 0xffa040, segundoAliento: 0x4fe0ff };
const FALLBACK = 0x6d757e;
/** Cada cuánto cambia el arma mientras gira El Contenedor. */
const SPIN_SWAP_SECONDS = 0.12;

/** Expositor flotante: todas las armas, normales y mejoradas, ya creadas; se enseña una. */
class WeaponDisplay {
  readonly root = new THREE.Group();
  private readonly guns = new Map<string, THREE.Group>();
  private shown: string | null = null;

  constructor(scene: THREE.Scene) {
    for (const id of Object.keys(WEAPON_SHAPES)) {
      for (const upgraded of [false, true]) {
        const g = buildWeapon(id, upgraded);
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
  private readonly labLights: THREE.PointLight[] = [];
  private readonly map: MapConfig;
  private spinPick = 0;
  private spinTimer = 0;
  private powerShown = false;

  constructor(scene: THREE.Scene, map: MapConfig) {
    this.map = map;
    for (const d of map.decor) scene.add(placeModel(d.model, d.box, d.facing, FALLBACK));
    const ps = map.powerSwitch;
    scene.add(placeModel(ps.model, ps.box, ps.facing, 0x8a8f2a));
    for (const st of map.perkStations) scene.add(placeModel(st.model, st.box, st.facing, PERK_GLOW[st.perk] ?? FALLBACK));
    scene.add(placeModel(map.forja.model, map.forja.box, map.forja.facing, 0x5a3a2a));
    for (const spot of map.contenedorSpots) {
      const m = placeModel(spot.model, spot.box, spot.facing, 0x56603a);
      this.boxModels.push(m);
      scene.add(m);
    }

    // Brillo de cada estación de suero: una esfera que se enciende cuando se puede comprar.
    for (const st of map.perkStations) {
      const color = PERK_GLOW[st.perk] ?? 0xffffff;
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color }));
      const [x0, , z0, x1, y1, z1] = st.box;
      mesh.position.set((x0 + x1) / 2 + st.facing[0] * ((x1 - x0) / 2 + 0.05), y1 + 0.1, (z0 + z1) / 2 + st.facing[1] * ((z1 - z0) / 2 + 0.05));
      this.perkGlows.push({ perk: st.perk, mesh });
      scene.add(mesh);
    }

    // Piloto del panel de energía: rojo apagado, verde encendido.
    this.powerLamp = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff3020 }));
    this.powerLamp.position.copy(anchorTop(ps)).add(new THREE.Vector3(0, 0.15, 0));
    scene.add(this.powerLamp);

    // La Forja brilla mientras trabaja.
    this.forjaGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xff6a1a, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.forjaGlow.position.copy(anchorTop(map.forja)).add(new THREE.Vector3(map.forja.facing[0] * 0.4, -0.5, map.forja.facing[1] * 0.4));
    scene.add(this.forjaGlow);

    this.boxDisplay = new WeaponDisplay(scene);
    this.forjaDisplay = new WeaponDisplay(scene);

    // Luces del Laboratorio: emergencia roja hasta que llega la energía.
    const [lx0, lz0, lx1, lz1] = map.labArea;
    for (const [fx, fz] of [
      [0.25, 0.17],
      [0.75, 0.83],
    ] as const) {
      const x = lx0 + (lx1 - lx0) * fx;
      const z = lz0 + (lz1 - lz0) * fz;
      const l = new THREE.PointLight(0xff2a1a, 6, 14, 1.6);
      l.position.set(x, 2.9, z);
      this.labLights.push(l);
      scene.add(l);
    }
  }

  update(game: Game, dt: number, time: number): void {
    const map = this.map;

    // Energía.
    if (game.power !== this.powerShown) {
      this.powerShown = game.power;
      (this.powerLamp.material as THREE.MeshBasicMaterial).color.setHex(game.power ? 0x40ff60 : 0xff3020);
      for (const l of this.labLights) {
        l.color.setHex(game.power ? 0xfff1d6 : 0xff2a1a);
        l.intensity = game.power ? 22 : 6;
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
