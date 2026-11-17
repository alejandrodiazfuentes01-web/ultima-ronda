/**
 * Forma de cada arma, hecha con piezas sencillas (cajas y cilindros), sin marcas
 * ni grabados. Es aspecto, no balance: los números de juego viven en weapons.json.
 *
 * Ejes del arma: el cañón apunta hacia -z, arriba es +y, la derecha es +x.
 * El origen está en el eje del cañón, a la altura del gatillo. Medidas en metros.
 */

export type V3 = [number, number, number];
export type Mat = 'steel' | 'dark' | 'polymer' | 'wood' | 'bakelite' | 'tan' | 'olive' | 'brass' | 'copper' | 'red' | 'glow';
/** Partes que se mueven por separado: cuerpo, cargador, corredera o palanca, y guardamanos de bombeo. */
export type PartGroup = 'body' | 'mag' | 'slide' | 'pump';

export interface PartSpec {
  group: PartGroup;
  mat: Mat;
  kind: 'box' | 'cyl';
  /** Caja: ancho, alto, largo. Cilindro: radio, largo, lados. */
  size: V3;
  at: V3;
  rot?: V3;
}

export interface WeaponDef {
  parts: PartSpec[];
  /** Boca del cañón: de ahí salen el fogonazo y las trazadoras. */
  muzzle: V3;
  /** Línea de mira: altura sobre el eje del cañón y posición de la mira trasera. */
  sightY: number;
  sightZ: number;
  /** Distancia del ojo a la mira trasera al apuntar. */
  eyeRelief: number;
  /** Por dónde salen los casquillos. */
  eject: V3;
  /** Dónde agarra la mano derecha y dónde sujeta la izquierda. */
  grip: V3;
  support: V3;
  supportPose: 'under' | 'cup';
  /** Posición del arma al llevarla a la cadera, respecto al ojo. */
  hip: V3;
  /** Hacia dónde sale el cargador al recargar (dirección y distancia). */
  magOut: V3;
  /** Recorrido hacia atrás de la corredera o de la palanca al disparar. */
  slideTravel: number;
  /** Recorrido del guardamanos de bombeo (0 si no es de corredera). */
  pumpTravel: number;
  casing: 'pistol' | 'rifle' | 'shell' | 'none';
}

let current: PartGroup = 'body';
/** Las piezas creadas dentro de `fn` pertenecen a ese grupo móvil. */
function group(g: PartGroup, fn: () => PartSpec[]): PartSpec[] {
  current = g;
  const parts = fn();
  current = 'body';
  return parts;
}

function box(mat: Mat, w: number, h: number, l: number, x: number, y: number, z: number, rotX = 0): PartSpec {
  return { group: current, mat, kind: 'box', size: [w, h, l], at: [x, y, z], ...(rotX ? { rot: [rotX, 0, 0] as V3 } : {}) };
}

function cyl(mat: Mat, radius: number, length: number, x: number, y: number, z: number, sides = 8, rot?: V3): PartSpec {
  return { group: current, mat, kind: 'cyl', size: [radius, length, sides], at: [x, y, z], ...(rot ? { rot } : {}) };
}

/** Guardamonte y gatillo, iguales en casi todas. */
function trigger(z: number, y = -0.03): PartSpec[] {
  return [box('dark', 0.008, 0.004, 0.058, 0, y - 0.022, z), box('dark', 0.008, 0.024, 0.004, 0, y - 0.011, z - 0.029), box('steel', 0.005, 0.016, 0.006, 0, y - 0.006, z + 0.004)];
}

const ACROSS: V3 = [0, Math.PI / 2, 0];
const UPRIGHT: V3 = [Math.PI / 2, 0, 0];

export const WEAPON_DEFS: Record<string, WeaponDef> = {
  // ---------------------------------------------------------------- M1911
  m1911: {
    parts: [
      box('dark', 0.024, 0.016, 0.165, 0, -0.018, -0.04),
      box('dark', 0.024, 0.09, 0.046, 0, -0.064, 0.034, -0.28),
      box('wood', 0.03, 0.07, 0.036, 0, -0.068, 0.036, -0.28),
      ...trigger(-0.02, -0.024),
      box('steel', 0.006, 0.014, 0.01, 0, 0.014, 0.064, -0.4),
      cyl('steel', 0.0068, 0.014, 0, 0, -0.151, 8),
      ...group('slide', () => [
        box('dark', 0.026, 0.028, 0.2, 0, 0.004, -0.045),
        box('steel', 0.0265, 0.012, 0.03, 0, 0.004, 0.025),
        box('dark', 0.005, 0.007, 0.008, -0.0065, 0.0215, 0.046),
        box('dark', 0.005, 0.007, 0.008, 0.0065, 0.0215, 0.046),
        box('dark', 0.003, 0.007, 0.008, 0, 0.0215, -0.136),
      ]),
      ...group('mag', () => [box('steel', 0.018, 0.092, 0.03, 0, -0.066, 0.033, -0.28), box('dark', 0.023, 0.007, 0.04, 0, -0.112, 0.047, -0.28)]),
    ],
    muzzle: [0, 0, -0.16],
    sightY: 0.0245,
    sightZ: 0.046,
    eyeRelief: 0.36,
    eject: [0.014, 0.014, -0.02],
    grip: [0, -0.066, 0.036],
    support: [0, -0.07, 0.03],
    supportPose: 'cup',
    hip: [0.07, -0.075, -0.33],
    magOut: [0, -0.12, 0.035],
    slideTravel: 0.035,
    pumpTravel: 0,
    casing: 'pistol',
  },

  // ---------------------------------------------------------------- M870
  m870: {
    parts: [
      box('dark', 0.036, 0.056, 0.22, 0, -0.008, 0),
      box('steel', 0.002, 0.02, 0.06, 0.0185, 0, -0.02),
      cyl('dark', 0.011, 0.5, 0, 0.008, -0.36, 8),
      cyl('dark', 0.0115, 0.42, 0, -0.02, -0.32, 8),
      cyl('dark', 0.014, 0.014, 0, -0.02, -0.535, 8),
      box('dark', 0.012, 0.05, 0.014, 0, -0.006, -0.5),
      box('brass', 0.004, 0.007, 0.005, 0, 0.0225, -0.6),
      ...trigger(0.02, -0.036),
      box('wood', 0.034, 0.05, 0.11, 0, -0.05, 0.155, -0.3),
      box('wood', 0.036, 0.078, 0.2, 0, -0.08, 0.3, -0.1),
      box('polymer', 0.038, 0.108, 0.02, 0, -0.09, 0.405, -0.1),
      ...group('pump', () => [
        box('wood', 0.046, 0.044, 0.16, 0, -0.022, -0.3),
        box('wood', 0.048, 0.006, 0.012, 0, -0.022, -0.25),
        box('wood', 0.048, 0.006, 0.012, 0, -0.022, -0.29),
        box('wood', 0.048, 0.006, 0.012, 0, -0.022, -0.33),
        box('steel', 0.004, 0.006, 0.19, 0.018, -0.02, -0.16),
      ]),
    ],
    muzzle: [0, 0.008, -0.62],
    sightY: 0.028,
    sightZ: 0.1,
    eyeRelief: 0.32,
    eject: [0.022, 0.004, -0.02],
    grip: [0, -0.05, 0.15],
    support: [0, -0.046, -0.3],
    supportPose: 'under',
    hip: [0.1, -0.11, -0.27],
    magOut: [0, -0.05, 0],
    slideTravel: 0,
    pumpTravel: 0.09,
    casing: 'shell',
  },

  // ---------------------------------------------------------------- SMG-5
  smg5: {
    parts: [
      cyl('dark', 0.021, 0.29, 0, 0.006, -0.03, 8),
      box('polymer', 0.036, 0.036, 0.17, 0, -0.022, 0.005),
      box('polymer', 0.042, 0.046, 0.14, 0, -0.004, -0.2),
      box('polymer', 0.044, 0.006, 0.1, 0, -0.03, -0.2),
      cyl('steel', 0.008, 0.07, 0, 0, -0.3, 8),
      cyl('dark', 0.011, 0.18, 0, 0.022, -0.215, 8),
      cyl('dark', 0.017, 0.014, 0, 0.03, -0.287, 8),
      box('dark', 0.003, 0.02, 0.006, 0, 0.034, -0.287),
      box('dark', 0.03, 0.012, 0.03, 0, 0.03, 0.07),
      box('dark', 0.007, 0.02, 0.012, -0.0095, 0.043, 0.07),
      box('dark', 0.007, 0.02, 0.012, 0.0095, 0.043, 0.07),
      box('polymer', 0.032, 0.088, 0.04, 0, -0.078, 0.04, -0.25),
      ...trigger(-0.005, -0.036),
      box('polymer', 0.034, 0.05, 0.2, 0, -0.008, 0.215),
      box('polymer', 0.036, 0.1, 0.03, 0, -0.03, 0.325),
      ...group('slide', () => [cyl('steel', 0.006, 0.03, -0.026, 0.022, -0.2, 6, ACROSS)]),
      ...group('mag', () => [box('dark', 0.024, 0.078, 0.032, 0, -0.078, -0.075, 0.12), box('dark', 0.024, 0.075, 0.032, 0, -0.146, -0.09, 0.3)]),
    ],
    muzzle: [0, 0, -0.34],
    sightY: 0.047,
    sightZ: 0.07,
    eyeRelief: 0.17,
    eject: [0.024, 0.012, -0.02],
    grip: [0, -0.078, 0.04],
    support: [0, -0.034, -0.2],
    supportPose: 'under',
    hip: [0.09, -0.1, -0.3],
    magOut: [0, -0.16, -0.03],
    slideTravel: 0.03,
    pumpTravel: 0,
    casing: 'pistol',
  },

  // ---------------------------------------------------------------- V-45
  v45: {
    parts: [
      box('polymer', 0.046, 0.06, 0.3, 0, 0.01, -0.08),
      box('dark', 0.042, 0.07, 0.085, 0, -0.045, -0.135),
      box('dark', 0.042, 0.04, 0.05, 0, -0.03, -0.2, 0.5),
      cyl('steel', 0.009, 0.05, 0, -0.005, -0.255, 8),
      cyl('dark', 0.0135, 0.034, 0, -0.005, -0.29, 8),
      box('dark', 0.024, 0.008, 0.28, 0, 0.044, -0.08),
      box('dark', 0.02, 0.026, 0.008, 0, 0.059, 0.045),
      box('dark', 0.004, 0.026, 0.008, 0, 0.059, -0.205),
      box('dark', 0.02, 0.008, 0.008, 0, 0.05, -0.205),
      box('polymer', 0.032, 0.09, 0.042, 0, -0.07, 0.05, -0.2),
      ...trigger(0.005, -0.03),
      box('polymer', 0.03, 0.052, 0.032, 0, -0.105, -0.14),
      box('polymer', 0.02, 0.02, 0.2, 0, 0.022, 0.17),
      box('polymer', 0.02, 0.02, 0.2, 0, -0.04, 0.17),
      box('polymer', 0.032, 0.1, 0.022, 0, -0.01, 0.275),
      ...group('slide', () => [box('steel', 0.03, 0.01, 0.014, -0.034, 0.012, -0.16)]),
      ...group('mag', () => [box('dark', 0.026, 0.17, 0.034, 0, -0.115, -0.055, 0.08), box('steel', 0.03, 0.008, 0.04, 0, -0.2, -0.062, 0.08)]),
    ],
    muzzle: [0, -0.005, -0.31],
    sightY: 0.0725,
    sightZ: 0.045,
    eyeRelief: 0.16,
    eject: [0.026, 0.014, -0.06],
    grip: [0, -0.072, 0.05],
    support: [0, -0.1, -0.14],
    supportPose: 'under',
    hip: [0.09, -0.105, -0.3],
    magOut: [0, -0.2, -0.016],
    slideTravel: 0.03,
    pumpTravel: 0,
    casing: 'pistol',
  },

  // ---------------------------------------------------------------- AK-74
  ak74: {
    parts: [
      box('dark', 0.036, 0.05, 0.27, 0, -0.005, 0),
      box('dark', 0.03, 0.016, 0.21, 0, 0.026, 0.025),
      box('dark', 0.03, 0.02, 0.05, 0, 0.03, -0.11),
      box('steel', 0.012, 0.006, 0.06, 0, 0.043, -0.105),
      box('dark', 0.014, 0.012, 0.006, 0, 0.049, -0.135),
      box('wood', 0.04, 0.04, 0.2, 0, -0.008, -0.235),
      box('wood', 0.03, 0.022, 0.15, 0, 0.026, -0.215),
      cyl('steel', 0.009, 0.12, 0, 0.03, -0.35, 8),
      cyl('dark', 0.008, 0.33, 0, 0, -0.5, 8),
      box('dark', 0.02, 0.034, 0.03, 0, 0.014, -0.42),
      box('dark', 0.012, 0.05, 0.02, 0, 0.028, -0.6),
      box('dark', 0.003, 0.012, 0.004, 0, 0.049, -0.6),
      cyl('dark', 0.0125, 0.065, 0, 0, -0.68, 8),
      box('bakelite', 0.03, 0.088, 0.036, 0, -0.072, 0.075, -0.3),
      ...trigger(0.015, -0.03),
      box('wood', 0.034, 0.06, 0.25, 0, -0.022, 0.255, -0.06),
      box('dark', 0.036, 0.11, 0.022, 0, -0.04, 0.385, -0.06),
      ...group('slide', () => [box('steel', 0.03, 0.01, 0.014, 0.03, 0.014, -0.04), box('steel', 0.004, 0.012, 0.09, 0.0185, 0.012, -0.01)]),
      ...group('mag', () => [
        box('bakelite', 0.026, 0.07, 0.056, 0, -0.066, -0.075, 0.15),
        box('bakelite', 0.026, 0.07, 0.056, 0, -0.127, -0.094, 0.36),
        box('bakelite', 0.026, 0.06, 0.056, 0, -0.18, -0.124, 0.58),
      ]),
    ],
    muzzle: [0, 0, -0.715],
    sightY: 0.0555,
    sightZ: -0.105,
    eyeRelief: 0.3,
    eject: [0.022, 0.02, -0.02],
    grip: [0, -0.074, 0.075],
    support: [0, -0.034, -0.235],
    supportPose: 'under',
    hip: [0.1, -0.115, -0.27],
    magOut: [0, -0.17, -0.08],
    slideTravel: 0.07,
    pumpTravel: 0,
    casing: 'rifle',
  },

  // ---------------------------------------------------------------- M16
  m16: {
    parts: [
      box('dark', 0.036, 0.066, 0.21, 0, -0.01, 0),
      box('dark', 0.02, 0.012, 0.17, 0, 0.064, 0.005),
      box('dark', 0.016, 0.034, 0.022, 0, 0.042, -0.065),
      box('dark', 0.016, 0.034, 0.022, 0, 0.042, 0.075),
      box('dark', 0.006, 0.014, 0.012, -0.007, 0.076, 0.075),
      box('dark', 0.006, 0.014, 0.012, 0.007, 0.076, 0.075),
      cyl('polymer', 0.027, 0.3, 0, 0, -0.255, 10),
      cyl('dark', 0.029, 0.012, 0, 0, -0.11, 10),
      cyl('dark', 0.029, 0.012, 0, 0, -0.405, 10),
      cyl('dark', 0.009, 0.27, 0, 0, -0.54, 8),
      box('dark', 0.012, 0.075, 0.02, 0, 0.042, -0.43),
      box('dark', 0.02, 0.02, 0.03, 0, 0.004, -0.43),
      box('dark', 0.003, 0.012, 0.004, 0, 0.0775, -0.43),
      cyl('dark', 0.0115, 0.045, 0, 0, -0.695, 8),
      box('polymer', 0.03, 0.086, 0.035, 0, -0.078, 0.075, -0.3),
      ...trigger(0.015, -0.04),
      cyl('dark', 0.014, 0.2, 0, 0.006, 0.2, 8),
      box('polymer', 0.034, 0.05, 0.14, 0, -0.012, 0.2, -0.1),
      box('polymer', 0.034, 0.1, 0.13, 0, -0.03, 0.32, -0.04),
      box('dark', 0.036, 0.122, 0.014, 0, -0.03, 0.39),
      ...group('slide', () => [box('dark', 0.034, 0.008, 0.024, 0, 0.028, 0.108)]),
      ...group('mag', () => [box('steel', 0.024, 0.07, 0.06, 0, -0.076, -0.045, 0.08), box('steel', 0.024, 0.07, 0.06, 0, -0.14, -0.056, 0.24)]),
    ],
    muzzle: [0, 0, -0.72],
    sightY: 0.0835,
    sightZ: 0.075,
    eyeRelief: 0.14,
    eject: [0.022, 0.01, -0.03],
    grip: [0, -0.08, 0.075],
    support: [0, -0.03, -0.255],
    supportPose: 'under',
    hip: [0.1, -0.12, -0.27],
    magOut: [0, -0.17, -0.04],
    slideTravel: 0.05,
    pumpTravel: 0,
    casing: 'rifle',
  },

  // ---------------------------------------------------------------- Mk 17
  mk17: {
    parts: [
      box('tan', 0.042, 0.06, 0.5, 0, 0.012, -0.13),
      box('dark', 0.022, 0.008, 0.48, 0, 0.046, -0.13),
      box('tan', 0.036, 0.036, 0.17, 0, -0.03, 0.035),
      box('dark', 0.044, 0.008, 0.2, 0, -0.02, -0.26),
      cyl('dark', 0.01, 0.2, 0, 0, -0.475, 8),
      box('dark', 0.02, 0.03, 0.03, 0, 0.016, -0.4),
      cyl('dark', 0.0145, 0.055, 0, 0, -0.6, 8),
      box('dark', 0.006, 0.03, 0.01, -0.007, 0.065, 0.085),
      box('dark', 0.006, 0.03, 0.01, 0.007, 0.065, 0.085),
      box('dark', 0.02, 0.012, 0.01, 0, 0.056, 0.085),
      box('dark', 0.004, 0.03, 0.01, 0, 0.065, -0.355),
      box('dark', 0.016, 0.012, 0.01, 0, 0.056, -0.355),
      box('polymer', 0.03, 0.088, 0.036, 0, -0.088, 0.09, -0.28),
      ...trigger(0.03, -0.046),
      box('tan', 0.036, 0.07, 0.2, 0, 0, 0.22),
      box('tan', 0.03, 0.02, 0.14, 0, 0.045, 0.21),
      box('tan', 0.034, 0.05, 0.08, 0, -0.05, 0.29),
      box('dark', 0.038, 0.122, 0.028, 0, -0.022, 0.335),
      ...group('slide', () => [box('dark', 0.03, 0.01, 0.02, -0.034, 0.02, -0.2)]),
      ...group('mag', () => [box('dark', 0.028, 0.115, 0.07, 0, -0.1, -0.058, 0.06), box('dark', 0.03, 0.008, 0.074, 0, -0.158, -0.062, 0.06)]),
    ],
    muzzle: [0, 0, -0.635],
    sightY: 0.08,
    sightZ: 0.085,
    eyeRelief: 0.14,
    eject: [0.025, 0.016, -0.04],
    grip: [0, -0.09, 0.09],
    support: [0, -0.03, -0.28],
    supportPose: 'under',
    hip: [0.1, -0.12, -0.27],
    magOut: [0, -0.18, -0.02],
    slideTravel: 0.06,
    pumpTravel: 0,
    casing: 'rifle',
  },

  // ---------------------------------------------------------------- M249
  m249: {
    parts: [
      box('dark', 0.05, 0.07, 0.36, 0, 0, 0),
      box('dark', 0.048, 0.02, 0.2, 0, 0.045, -0.02),
      box('polymer', 0.05, 0.05, 0.2, 0, -0.015, -0.28),
      box('dark', 0.03, 0.012, 0.2, 0, 0.03, -0.3),
      cyl('dark', 0.011, 0.32, 0, 0, -0.54, 8),
      cyl('dark', 0.008, 0.25, 0, -0.022, -0.5, 6),
      cyl('dark', 0.0145, 0.055, 0, 0, -0.71, 8),
      box('dark', 0.004, 0.066, 0.012, 0, 0.051, -0.6),
      box('dark', 0.024, 0.02, 0.02, 0, 0.012, -0.6),
      box('dark', 0.012, 0.012, 0.13, 0.022, 0.066, -0.2),
      box('dark', 0.012, 0.03, 0.012, 0.022, 0.05, -0.145),
      box('dark', 0.012, 0.03, 0.012, 0.022, 0.05, -0.255),
      box('dark', 0.007, 0.026, 0.03, -0.009, 0.069, 0.105),
      box('dark', 0.007, 0.026, 0.03, 0.009, 0.069, 0.105),
      box('polymer', 0.03, 0.088, 0.036, 0, -0.083, 0.105, -0.28),
      ...trigger(0.045, -0.042),
      box('polymer', 0.04, 0.06, 0.2, 0, -0.005, 0.28),
      box('polymer', 0.042, 0.122, 0.03, 0, -0.02, 0.39),
      cyl('dark', 0.006, 0.22, -0.02, -0.046, -0.45, 6),
      cyl('dark', 0.006, 0.22, 0.02, -0.046, -0.45, 6),
      ...group('slide', () => [box('steel', 0.03, 0.012, 0.016, 0.04, 0.0, 0.02)]),
      ...group('mag', () => [
        box('olive', 0.09, 0.11, 0.13, -0.012, -0.115, -0.07),
        box('dark', 0.092, 0.012, 0.132, -0.012, -0.058, -0.07),
        box('brass', 0.03, 0.014, 0.05, -0.04, 0.038, -0.06),
      ]),
    ],
    muzzle: [0, 0, -0.74],
    sightY: 0.084,
    sightZ: 0.105,
    eyeRelief: 0.14,
    eject: [0.03, -0.02, -0.03],
    grip: [0, -0.086, 0.105],
    support: [0, -0.046, -0.28],
    supportPose: 'under',
    hip: [0.105, -0.125, -0.25],
    magOut: [-0.04, -0.2, 0],
    slideTravel: 0.05,
    pumpTravel: 0,
    casing: 'rifle',
  },

  // ---------------------------------------------------------------- SVD
  svd: {
    parts: [
      box('dark', 0.036, 0.05, 0.27, 0, -0.005, 0),
      box('steel', 0.034, 0.014, 0.22, 0, 0.025, 0.02),
      box('wood', 0.04, 0.046, 0.24, 0, 0, -0.26),
      box('dark', 0.042, 0.008, 0.03, 0, 0, -0.2),
      box('dark', 0.042, 0.008, 0.03, 0, 0, -0.26),
      box('dark', 0.042, 0.008, 0.03, 0, 0, -0.32),
      cyl('dark', 0.008, 0.52, 0, 0, -0.64, 8),
      box('dark', 0.018, 0.03, 0.03, 0, 0.012, -0.44),
      box('dark', 0.012, 0.046, 0.02, 0, 0.026, -0.84),
      cyl('dark', 0.012, 0.075, 0, 0, -0.9, 8),
      box('wood', 0.03, 0.09, 0.046, 0, -0.068, 0.105, -0.4),
      ...trigger(0.03, -0.03),
      box('wood', 0.03, 0.03, 0.3, 0, 0.002, 0.29),
      box('wood', 0.03, 0.03, 0.25, 0, -0.08, 0.3, 0.18),
      box('dark', 0.032, 0.125, 0.025, 0, -0.04, 0.45),
      box('dark', 0.034, 0.022, 0.12, 0, 0.028, 0.28),
      cyl('dark', 0.018, 0.27, 0, 0.078, -0.02, 10),
      cyl('dark', 0.025, 0.07, 0, 0.078, -0.18, 10),
      cyl('dark', 0.0225, 0.055, 0, 0.078, 0.135, 10),
      cyl('glow', 0.02, 0.004, 0, 0.078, -0.214, 10),
      box('dark', 0.014, 0.032, 0.1, -0.012, 0.046, 0),
      cyl('dark', 0.008, 0.022, 0, 0.1, -0.02, 8, UPRIGHT),
      cyl('dark', 0.008, 0.022, 0.02, 0.078, -0.02, 8, ACROSS),
      ...group('slide', () => [box('steel', 0.03, 0.01, 0.014, 0.03, 0.012, -0.03)]),
      ...group('mag', () => [box('dark', 0.026, 0.085, 0.066, 0, -0.072, -0.062, 0.14), box('dark', 0.028, 0.008, 0.07, 0, -0.114, -0.07, 0.14)]),
    ],
    muzzle: [0, 0, -0.945],
    sightY: 0.078,
    sightZ: 0.16,
    eyeRelief: 0.09,
    eject: [0.022, 0.02, -0.02],
    grip: [0, -0.07, 0.105],
    support: [0, -0.03, -0.26],
    supportPose: 'under',
    hip: [0.1, -0.125, -0.26],
    magOut: [0, -0.15, -0.03],
    slideTravel: 0.06,
    pumpTravel: 0,
    casing: 'rifle',
  },

  // ---------------------------------------------------------------- Arco voltaico
  arco: {
    parts: [
      box('steel', 0.05, 0.06, 0.2, 0, 0, -0.02),
      box('dark', 0.044, 0.052, 0.045, 0, 0, 0.1),
      box('dark', 0.052, 0.01, 0.16, 0, -0.012, -0.02),
      cyl('glow', 0.013, 0.13, 0, 0, -0.185, 8),
      cyl('copper', 0.031, 0.012, 0, 0, -0.135, 10),
      cyl('copper', 0.031, 0.012, 0, 0, -0.162, 10),
      cyl('copper', 0.031, 0.012, 0, 0, -0.189, 10),
      cyl('copper', 0.031, 0.012, 0, 0, -0.216, 10),
      cyl('dark', 0.034, 0.014, 0, 0, -0.243, 10),
      box('steel', 0.008, 0.014, 0.15, -0.032, 0, -0.305),
      box('steel', 0.008, 0.014, 0.15, 0.032, 0, -0.305),
      box('glow', 0.01, 0.016, 0.014, -0.032, 0, -0.386),
      box('glow', 0.01, 0.016, 0.014, 0.032, 0, -0.386),
      cyl('dark', 0.02, 0.11, 0, 0.046, 0, 8),
      cyl('glow', 0.021, 0.008, 0, 0.046, -0.03, 8),
      cyl('glow', 0.021, 0.008, 0, 0.046, 0.03, 8),
      box('dark', 0.006, 0.014, 0.01, -0.008, 0.071, 0.045),
      box('dark', 0.006, 0.014, 0.01, 0.008, 0.071, 0.045),
      box('steel', 0.004, 0.05, 0.006, 0, 0.053, -0.235),
      box('polymer', 0.032, 0.09, 0.04, 0, -0.076, 0.045, -0.25),
      ...trigger(0.0, -0.032),
      ...group('mag', () => [box('dark', 0.036, 0.06, 0.07, 0, -0.058, -0.07), box('glow', 0.038, 0.008, 0.05, 0, -0.058, -0.07)]),
    ],
    muzzle: [0, 0, -0.39],
    sightY: 0.078,
    sightZ: 0.045,
    eyeRelief: 0.26,
    eject: [0, 0, 0],
    grip: [0, -0.076, 0.045],
    support: [0, -0.08, 0.035],
    supportPose: 'cup',
    hip: [0.075, -0.085, -0.3],
    magOut: [0, -0.12, 0],
    slideTravel: 0,
    pumpTravel: 0,
    casing: 'none',
  },
};

export const WEAPON_IDS = Object.keys(WEAPON_DEFS);
