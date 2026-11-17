/**
 * Construye los modelos de las armas a partir de sus formas (defs.ts). Las piezas
 * del mismo grupo móvil y el mismo material se unen en una sola malla, para que
 * cada arma cueste pocas llamadas de dibujo. Se construyen todas al arrancar (regla 5).
 */
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WEAPON_DEFS, type Mat, type PartGroup, type PartSpec, type WeaponDef } from './defs';

/** Materiales normales y los de un arma mejorada en La Forja (bronce oscuro con vetas al rojo). */
function makeMaterials(upgraded: boolean): Record<Mat, THREE.Material> {
  const std = (color: number, roughness: number, metalness: number, emissive = 0, emissiveIntensity = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, emissiveIntensity });
  if (upgraded) {
    const forged = std(0x2b1d16, 0.35, 0.75, 0xff5a12, 0.18);
    const hot = std(0x8a4a24, 0.3, 0.85, 0xff7a2a, 0.45);
    return {
      steel: hot,
      dark: forged,
      polymer: forged,
      wood: std(0x3a2416, 0.5, 0.3, 0xff5a12, 0.12),
      bakelite: forged,
      tan: forged,
      olive: forged,
      brass: std(0xd8a040, 0.25, 0.9, 0xff8a2a, 0.3),
      copper: hot,
      red: hot,
      glow: std(0xffb070, 0.3, 0, 0xff6a1a, 2.4),
    };
  }
  return {
    steel: std(0x8a9098, 0.4, 0.45),
    dark: std(0x3a3e44, 0.5, 0.35),
    polymer: std(0x2c2f33, 0.75, 0.05),
    wood: std(0x6b4126, 0.62, 0),
    bakelite: std(0x6e2a18, 0.45, 0.05),
    tan: std(0x9a8463, 0.75, 0.05),
    olive: std(0x4b5233, 0.8, 0.05),
    brass: std(0xc89b3c, 0.35, 0.5),
    copper: std(0xb8673a, 0.35, 0.5),
    red: std(0x8a2020, 0.6, 0.05),
    glow: std(0x9fe8ff, 0.3, 0, 0x40c8ff, 2.2),
  };
}

const MATERIALS = { normal: makeMaterials(false), upgraded: makeMaterials(true) };

function partGeometry(p: PartSpec): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  if (p.kind === 'box') {
    g = new THREE.BoxGeometry(p.size[0], p.size[1], p.size[2]);
  } else {
    // Los cilindros van tumbados a lo largo del cañón salvo que se giren.
    g = new THREE.CylinderGeometry(p.size[0], p.size[0], p.size[1], p.size[2]);
    g.rotateX(Math.PI / 2);
  }
  if (p.rot) {
    g.rotateX(p.rot[0]);
    g.rotateY(p.rot[1]);
    g.rotateZ(p.rot[2]);
  }
  g.translate(p.at[0], p.at[1], p.at[2]);
  // Sin coordenadas de textura: así todas las piezas se pueden unir.
  g.deleteAttribute('uv');
  return g;
}

export interface WeaponModel {
  root: THREE.Group;
  /** Grupos móviles del arma. El del cuerpo es la raíz misma. */
  parts: Record<PartGroup, THREE.Group>;
  def: WeaponDef;
}

/** Construye un arma. `upgraded` le da el aspecto de La Forja. */
export function buildWeapon(id: string, upgraded = false): WeaponModel {
  const def = WEAPON_DEFS[id] ?? WEAPON_DEFS.m1911!;
  const mats = upgraded ? MATERIALS.upgraded : MATERIALS.normal;
  const root = new THREE.Group();
  const parts: Record<PartGroup, THREE.Group> = { body: root, mag: new THREE.Group(), slide: new THREE.Group(), pump: new THREE.Group() };
  parts.mag.name = 'mag';
  root.add(parts.mag, parts.slide, parts.pump);

  const buckets = new Map<string, THREE.BufferGeometry[]>();
  for (const p of def.parts) {
    const key = `${p.group}:${p.mat}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(partGeometry(p));
  }
  for (const [key, geos] of buckets) {
    const [group, mat] = key.split(':') as [PartGroup, Mat];
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mats[mat]);
    parts[group].add(mesh);
  }
  return { root, parts, def };
}

// ------------------------------------------------------------------ manos

const gloveMat = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.85, metalness: 0 });
const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x55603f, roughness: 0.9, metalness: 0 });
const cuffMat = new THREE.MeshStandardMaterial({ color: 0x23251f, roughness: 0.9, metalness: 0 });

function boxAt(w: number, h: number, l: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, l);
  g.rotateX(rx);
  g.rotateY(ry);
  g.rotateZ(rz);
  g.translate(x, y, z);
  g.deleteAttribute('uv');
  return g;
}

function mergedMesh(geos: THREE.BufferGeometry[], mat: THREE.Material): THREE.Mesh {
  const g = mergeGeometries(geos, false)!;
  for (const x of geos) x.dispose();
  return new THREE.Mesh(g, mat);
}

/**
 * Mano con guante y antebrazo con manga. El origen es el centro de la palma;
 * el antebrazo sale hacia +z (hacia el jugador). `pose` decide cómo cierra los dedos.
 */
export function buildHand(pose: 'grip' | 'under' | 'cup', side: 'right' | 'left'): THREE.Group {
  const s = side === 'right' ? 1 : -1;
  const hand: THREE.BufferGeometry[] = [];
  if (pose === 'grip') {
    // Puño cerrado alrededor de la empuñadura, con el pulgar por encima.
    hand.push(boxAt(0.05, 0.075, 0.06, s * 0.012, 0, 0.004));
    for (let i = 0; i < 4; i++) hand.push(boxAt(0.016, 0.016, 0.034, -s * 0.024, 0.028 - i * 0.019, -0.022));
    hand.push(boxAt(0.016, 0.016, 0.05, -s * 0.012, 0.045, -0.006, 0.3, 0, 0));
  } else if (pose === 'under') {
    // Palma hacia arriba bajo el guardamanos, dedos subiendo por los lados.
    hand.push(boxAt(0.062, 0.026, 0.07, 0, -0.012, 0));
    for (let i = 0; i < 4; i++) hand.push(boxAt(0.012, 0.036, 0.015, 0.03, 0.01, -0.028 + i * 0.018));
    hand.push(boxAt(0.012, 0.03, 0.04, -0.03, 0.006, -0.01));
  } else {
    // Mano que envuelve a la otra por debajo (pistola).
    hand.push(boxAt(0.056, 0.07, 0.06, 0, 0, 0.01));
    for (let i = 0; i < 4; i++) hand.push(boxAt(0.034, 0.016, 0.018, s * 0.02, 0.028 - i * 0.019, -0.03));
  }
  const root = new THREE.Group();
  root.add(mergedMesh(hand, gloveMat));
  // Puño de la manga y antebrazo, largos para que siempre salgan del borde de la pantalla.
  root.add(mergedMesh([boxAt(0.066, 0.07, 0.03, 0, 0, 0.05)], cuffMat));
  root.add(mergedMesh([boxAt(0.075, 0.08, 0.5, 0, 0, 0.3)], sleeveMat));
  return root;
}

/** Ids de todas las armas con modelo. */
export { WEAPON_IDS } from './defs';
