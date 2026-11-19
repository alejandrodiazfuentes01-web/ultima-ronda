/**
 * Lo que se ve al aire libre: la nieve que cae sobre el Patio y la torre de radio,
 * que asoma por encima de los muros y se ve desde varias zonas. Todo se crea al
 * arrancar (regla 5).
 */
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MapConfig } from '../../shared/config';

const FLAKES = 360;
const FALL_SPEED = 0.9;
const SNOW_TOP = 7;

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3(1, 1, 1);

/** Copos que caen dentro de un rectángulo, con un vaivén suave. */
export class Snow {
  readonly mesh: THREE.InstancedMesh;
  private readonly pos = new Float32Array(FLAKES * 3);
  private readonly phase = new Float32Array(FLAKES);

  constructor(private readonly area: [number, number, number, number]) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.035, 0.035),
      new THREE.MeshBasicMaterial({ color: 0xeef3ff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
      FLAKES,
    );
    this.mesh.frustumCulled = false;
    const [x0, z0, x1, z1] = area;
    for (let i = 0; i < FLAKES; i++) {
      this.pos[i * 3] = x0 + Math.random() * (x1 - x0);
      this.pos[i * 3 + 1] = Math.random() * SNOW_TOP;
      this.pos[i * 3 + 2] = z0 + Math.random() * (z1 - z0);
      this.phase[i] = Math.random() * Math.PI * 2;
    }
  }

  update(dt: number, time: number, cameraYaw: number): void {
    if (!this.mesh.visible) return;
    tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), cameraYaw);
    for (let i = 0; i < FLAKES; i++) {
      let y = this.pos[i * 3 + 1]! - FALL_SPEED * dt * (0.7 + (i % 5) * 0.12);
      if (y < 0) y += SNOW_TOP;
      this.pos[i * 3 + 1] = y;
      const sway = Math.sin(time * 0.8 + this.phase[i]!) * 0.25;
      tmpP.set(this.pos[i * 3]! + sway, y, this.pos[i * 3 + 2]! + Math.cos(time * 0.6 + this.phase[i]!) * 0.2);
      tmpM.compose(tmpP, tmpQ, tmpS);
      this.mesh.setMatrixAt(i, tmpM);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Una viga entre dos puntos, como caja. */
function beam(a: THREE.Vector3, b: THREE.Vector3, thick: number): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(thick, thick, len);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  g.deleteAttribute('uv');
  return g;
}

/** Torre de radio de celosía: cuatro patas que se estrechan, anillos y cruces, y una baliza roja arriba. */
export class RadioTower {
  readonly root = new THREE.Group();
  private readonly beacon: THREE.Mesh;

  constructor(map: MapConfig) {
    const t = map.radioTower!;
    const [cx, cz] = t.center;
    const topHalf = t.half * 0.25;
    const corner = (i: number, y: number) => {
      const h = t.half + (topHalf - t.half) * (y / t.height);
      const s = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ][i]!;
      return new THREE.Vector3(cx + s[0]! * h, y, cz + s[1]! * h);
    };
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) parts.push(beam(corner(i, 0), corner(i, t.height), t.leg));
    const levels = 6;
    for (let k = 1; k <= levels; k++) {
      const y0 = (t.height * (k - 1)) / levels;
      const y1 = (t.height * k) / levels;
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        parts.push(beam(corner(i, y1), corner(j, y1), 0.1));
        // Cruz en cada cara, alternando el sentido.
        parts.push(beam(k % 2 ? corner(i, y0) : corner(j, y0), k % 2 ? corner(j, y1) : corner(i, y1), 0.07));
      }
    }
    // Mástil y antena.
    parts.push(beam(new THREE.Vector3(cx, t.height, cz), new THREE.Vector3(cx, t.height + 3, cz), 0.12));
    const metal = new THREE.MeshStandardMaterial({ color: 0x5c6168, roughness: 0.6, metalness: 0.5 });
    this.root.add(new THREE.Mesh(mergeGeometries(parts, false)!, metal));
    for (const p of parts) p.dispose();
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
    this.beacon.position.set(cx, t.height + 3.2, cz);
    this.root.add(this.beacon);
  }

  update(time: number): void {
    // La baliza parpadea, como en una antena de verdad.
    this.beacon.visible = Math.sin(time * 3) > -0.2;
  }
}
