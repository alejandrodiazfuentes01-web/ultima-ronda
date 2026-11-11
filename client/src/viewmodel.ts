/**
 * Arma en primera persona, sin brazos y animada por código (GDD, «Arte y
 * animación»): balanceo al andar, retroceso al disparar, bajada al recargar y
 * al cambiar de arma, y un fogonazo breve.
 */
import * as THREE from 'three/webgpu';
import type { Game } from '../../shared/sim/game';
import type { SimEvent } from '../../shared/sim/types';

/** Forma en cajas grises de cada arma: piezas [ancho, alto, largo, x, y, z]. */
const SHAPES: Record<string, Array<[number, number, number, number, number, number]>> = {
  m1911: [
    [0.035, 0.045, 0.2, 0, 0, -0.05],
    [0.03, 0.09, 0.04, 0, -0.06, 0.02],
  ],
  smg5: [
    [0.045, 0.06, 0.34, 0, 0, -0.1],
    [0.03, 0.1, 0.035, 0, -0.07, 0.0],
    [0.025, 0.09, 0.03, 0, -0.06, -0.14],
    [0.03, 0.05, 0.14, 0, -0.005, 0.12],
  ],
};

/** Retroceso visual según el nivel de weapons.json. */
const RECOIL_KICK: Record<string, number> = { none: 0, low: 0.012, medium: 0.03, high: 0.05, veryHigh: 0.07 };

const REST = new THREE.Vector3(0.12, -0.13, -0.36);
const SCALE = 0.6;

export class Viewmodel {
  private readonly root = new THREE.Group();
  private readonly guns = new Map<string, THREE.Group>();
  private readonly flash: THREE.Mesh;
  private shown: string | null = null;
  private kick = 0;
  private flashTime = 0;
  private bobPhase = 0;

  constructor(camera: THREE.Camera) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.55, metalness: 0.4 });
    for (const [id, parts] of Object.entries(SHAPES)) {
      const g = new THREE.Group();
      for (const [w, h, l, x, y, z] of parts) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat);
        m.position.set(x, y, z);
        g.add(m);
      }
      g.visible = false;
      this.guns.set(id, g);
      this.root.add(g);
    }
    this.flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd38a }),
    );
    this.flash.visible = false;
    this.root.add(this.flash);
    this.root.position.copy(REST);
    this.root.scale.setScalar(SCALE);
    camera.add(this.root);
  }

  onEvent(ev: SimEvent): void {
    if (ev.type === 'shot') {
      this.kick = Math.min(this.kick + 1, 1.5);
      this.flashTime = 0.05;
    }
  }

  update(game: Game, weapon: string | null, dt: number): void {
    if (weapon !== this.shown) {
      for (const [id, g] of this.guns) g.visible = id === weapon;
      this.shown = weapon;
    }
    const p = game.player;
    const cfg = weapon ? game.cfg.weapons[weapon] : undefined;
    const front = SHAPES[weapon ?? '']?.[0];

    // Fogonazo en la boca del arma.
    this.flashTime -= dt;
    this.flash.visible = this.flashTime > 0;
    if (front) this.flash.position.set(front[3], front[4], front[5] - front[2] / 2 - 0.03);

    // Retroceso que se recupera solo.
    this.kick = Math.max(0, this.kick - dt * 10);
    const kickAmount = this.kick * (RECOIL_KICK[cfg?.recoil ?? 'none'] ?? 0);

    // Balanceo al moverse.
    const speed = Math.hypot(p.pos.x - p.prevPos.x, p.pos.z - p.prevPos.z) * 60;
    this.bobPhase += dt * speed * 2.2;
    const bob = Math.min(speed / 6, 1);

    // Recarga y cambio de arma: el arma baja y vuelve.
    let lower = 0;
    if (p.reloadTimer > 0 && cfg) lower = Math.sin(Math.PI * (1 - p.reloadTimer / cfg.reloadSeconds)) * 0.18;
    const sw = game.cfg.player.weaponSwitchSeconds;
    if (p.switchTimer > 0 && sw > 0) lower = Math.max(lower, (p.switchTimer / sw) * 0.25);

    this.root.position.set(
      REST.x + Math.sin(this.bobPhase) * 0.012 * bob,
      REST.y - Math.abs(Math.cos(this.bobPhase)) * 0.01 * bob - lower,
      REST.z + kickAmount,
    );
    this.root.rotation.set(kickAmount * 2 + lower * 1.5, 0, 0);
  }
}
