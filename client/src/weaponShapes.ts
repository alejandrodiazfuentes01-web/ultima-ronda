/**
 * Formas de las armas, hechas con cajas (sin brazos ni marcas): las usa el arma
 * en primera persona y las que flotan en El Contenedor y La Forja.
 * Cada pieza: [ancho, alto, largo, x, y, z]; el cañón apunta hacia -z.
 */
import * as THREE from 'three/webgpu';

export type Piece = [number, number, number, number, number, number];

export const WEAPON_SHAPES: Record<string, Piece[]> = {
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
  mk17: [
    [0.05, 0.07, 0.5, 0, 0, -0.17],
    [0.03, 0.11, 0.04, 0, -0.08, 0.02],
    [0.035, 0.1, 0.05, 0, -0.08, -0.12],
    [0.04, 0.07, 0.2, 0, -0.01, 0.17],
    [0.02, 0.03, 0.12, 0, 0.05, -0.1],
  ],
  m249: [
    [0.06, 0.08, 0.56, 0, 0, -0.19],
    [0.08, 0.1, 0.1, 0.04, -0.08, -0.06],
    [0.03, 0.11, 0.04, 0, -0.08, 0.04],
    [0.045, 0.08, 0.2, 0, -0.01, 0.2],
    [0.03, 0.03, 0.18, 0, 0.055, -0.2],
  ],
  svd: [
    [0.04, 0.06, 0.66, 0, 0, -0.25],
    [0.03, 0.11, 0.04, 0, -0.08, 0.04],
    [0.03, 0.08, 0.05, 0, -0.07, -0.08],
    [0.035, 0.07, 0.2, 0, -0.02, 0.2],
    [0.035, 0.035, 0.16, 0, 0.07, -0.02],
  ],
  arco: [
    [0.06, 0.07, 0.24, 0, 0, -0.06],
    [0.09, 0.09, 0.05, 0, 0, -0.2],
    [0.03, 0.1, 0.04, 0, -0.07, 0.03],
    [0.02, 0.02, 0.2, 0.035, 0.04, -0.06],
  ],
};

const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.55, metalness: 0.4 });
const upgradedMat = new THREE.MeshStandardMaterial({ color: 0x3a2a22, roughness: 0.4, metalness: 0.6, emissive: 0xff6a1a, emissiveIntensity: 0.35 });
const arcMat = new THREE.MeshStandardMaterial({ color: 0x3d4a52, roughness: 0.4, metalness: 0.5, emissive: 0x40c8ff, emissiveIntensity: 0.4 });

/** Construye la forma de un arma. `upgraded` le da el brillo de La Forja. */
export function buildWeapon(id: string, upgraded = false): THREE.Group {
  const g = new THREE.Group();
  const mat = upgraded ? upgradedMat : id === 'arco' ? arcMat : bodyMat;
  for (const [w, h, l, x, y, z] of WEAPON_SHAPES[id] ?? WEAPON_SHAPES.m1911!) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat);
    m.position.set(x, y, z);
    g.add(m);
  }
  return g;
}
