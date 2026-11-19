// Genera shared/data/maps/prototipo.json: la Estación Aurora, una estación de montaña.
//
// Cada zona está hecha de piezas rectangulares («salas») con su altura de suelo y de
// techo; las rampas y escaleras unen alturas distintas. Los muros se describen como
// líneas con huecos (ventanas, compuertas, pasos abiertos), así no se repiten ni se
// solapan. Uso: node scripts/generar-estacion.mjs
import { writeFileSync } from 'node:fs';

const T = 0.2; // medio grosor de muro
const SILL = 0.9; // alféizar sobre el suelo de dentro
const WIN_TOP = 2.2; // parte de arriba de la ventana sobre el suelo de dentro
const DOOR_TOP = 2.6;
const r = (v) => Math.round(v * 1000) / 1000;

// ---------------------------------------------------------------- zonas y salas
// rect = [x0, z0, x1, z1]; floor = altura del suelo; height = de suelo a techo.
const zones = [
  { id: 'vestibulo', startsOpen: true, rooms: [{ rect: [0, 0, 12, 12], floor: 0, height: 3.2, roofed: true }], lights: [[6, 6]] },
  {
    id: 'laboratorio',
    startsOpen: false,
    rooms: [
      { rect: [12, 4.5, 30, 7.5], floor: 0, height: 3.2, roofed: true }, // pasillo largo
      { rect: [15, -1, 21, 4.5], floor: 0, height: 3.2, roofed: true }, // sala norte
      { rect: [22, 7.5, 28, 12.5], floor: 0, height: 3.2, roofed: true }, // sala sur
    ],
    lights: [[17, 6], [25, 10]],
  },
  {
    id: 'energia',
    startsOpen: false,
    rooms: [{ rect: [33, -1, 41, 9.5], floor: -1.2, height: 3.2, roofed: true }], // sótano
    lights: [[38.5, 8]],
  },
  {
    id: 'almacen',
    startsOpen: false,
    rooms: [
      { rect: [2, 12, 5, 15], floor: 0, height: 3.2, roofed: true }, // paso desde el Vestíbulo
      { rect: [-3, 15, 13, 27], floor: 0, height: 4.5, roofed: true }, // hangar
    ],
    lights: [[4.5, 21]],
  },
  { id: 'patio', startsOpen: false, rooms: [{ rect: [13, 12.5, 28, 27], floor: 0, height: 3.2, roofed: false }], lights: [[21, 15]] },
  { id: 'torre', startsOpen: false, rooms: [{ rect: [31, 14, 41, 27], floor: 1.2, height: 3.2, roofed: false }], lights: [[33.5, 16.5]] },
];

// Rampas y escaleras: y0 en el lado de menor coordenada del eje, y1 en el de mayor.
const ramps = [
  { zone: 'energia', rect: [30, 4.5, 33, 7.5], axis: 'x', y0: 0, y1: -1.2, stairs: true, roof: 3.2 },
  { zone: 'torre', rect: [36, 9.5, 38, 14], axis: 'z', y0: -1.2, y1: 1.2, stairs: true, roof: null },
  { zone: 'torre', rect: [28, 18.5, 31, 21.5], axis: 'x', y0: 0, y1: 1.2, stairs: false, roof: null },
];

// ---------------------------------------------------------------- muros
const walls = [];
const windows = [];
const doors = [];

/**
 * Una línea de muro de `y0` a `y1`, en z (horizontal) o en x (vertical), con huecos.
 * Cada hueco: [a, b] paso abierto, o { a, b, win: {...} } ventana, o { a, b, door: {...} } compuerta.
 */
function line(dir, at, from, to, y0, y1, holes = []) {
  const seg = (a, b, yb, yt) => {
    if (b - a < 0.001 || yt - yb < 0.001) return;
    walls.push(dir === 'z' ? [r(a), r(yb), r(at - T), r(b), r(yt), r(at + T)] : [r(at - T), r(yb), r(a), r(at + T), r(yt), r(b)]);
  };
  const hs = holes.map((h) => (Array.isArray(h) ? { a: h[0], b: h[1] } : h)).sort((p, q) => p.a - q.a);
  let cur = from;
  for (const h of hs) {
    seg(cur, h.a, y0, y1);
    cur = h.b;
    if (h.win) {
      const w = h.win;
      const base = Math.min(w.floor, w.ground);
      seg(h.a, h.b, base, w.floor + SILL); // alféizar
      seg(h.a, h.b, w.floor + WIN_TOP, y1); // dintel
      const c = (h.a + h.b) / 2;
      const s = w.out; // hacia fuera: +1 o -1 sobre el eje perpendicular
      const p = (d) => (dir === 'z' ? [r(c), r(at + s * d)] : [r(at + s * d), r(c)]);
      windows.push({
        id: w.id,
        zone: w.zone,
        opening: dir === 'z' ? [h.a, r(at - T), h.b, r(at + T)] : [r(at - T), h.a, r(at + T), h.b],
        inside: p(-0.9),
        outside: p(0.9),
        spawn: p(w.spawn ?? 6),
        floorY: w.floor,
        groundY: w.ground,
        sillTop: r(w.floor + SILL),
        top: r(w.floor + WIN_TOP),
        wallTop: y1,
      });
    }
    if (h.door) {
      const d = h.door;
      seg(h.a, h.b, d.floor + DOOR_TOP, y1); // dintel
      const c = (h.a + h.b) / 2;
      doors.push({
        id: d.id,
        cost: d.cost,
        connects: d.connects,
        box: dir === 'z' ? [h.a, d.floor, r(at - T), h.b, r(d.floor + DOOR_TOP), r(at + T)] : [r(at - T), d.floor, h.a, r(at + T), r(d.floor + DOOR_TOP), h.b],
        anchors: dir === 'z' ? [[r(c), r(at - 0.8)], [r(c), r(at + 0.8)]] : [[r(at - 0.8), r(c)], [r(at + 0.8), r(c)]],
      });
    }
  }
  seg(cur, to, y0, y1);
}
const win = (a, b, id, zone, floor, ground, out, spawn) => ({ a, b, win: { id, zone, floor, ground, out, spawn } });
const door = (a, b, id, cost, connects, floor = 0) => ({ a, b, door: { id, cost, connects, floor } });

// ---- Vestíbulo: la entrada, con cuatro ventanas (las dos primeras, norte y oeste)
line('z', 0, -T, 12 + T, 0, 3.2, [win(5, 7, 'vestibulo-norte', 'vestibulo', 0, 0, -1), win(1.5, 3.5, 'vestibulo-norte-2', 'vestibulo', 0, 0, -1)]);
line('x', 0, T, 12 - T, 0, 3.2, [win(5, 7, 'vestibulo-oeste', 'vestibulo', 0, 0, -1), win(8.5, 10.5, 'vestibulo-oeste-2', 'vestibulo', 0, 0, -1)]);
line('z', 12, -T, 12 + T, 0, 3.2, [door(2.5, 4.5, 'puerta-2', 750, ['vestibulo', 'almacen'])]);
line('x', 12, T, 12 - T, 0, 3.2, [door(5, 7, 'puerta-1', 750, ['vestibulo', 'laboratorio'])]);

// ---- Laboratorio: un pasillo largo hacia el este, con una sala a cada lado
line('z', 4.5, 12 + T, 30 + T, 0, 3.2, [[16.5, 19.5], win(25.5, 27.5, 'laboratorio-pasillo', 'laboratorio', 0, 0, -1)]);
line('z', 7.5, 12 + T, 30 + T, 0, 3.2, [[23.5, 26.5]]);
line('x', 15, -1 - T, 4.5 - T, 0, 3.2);
line('x', 21, -1 - T, 4.5 - T, 0, 3.2);
line('z', -1, 15 - T, 21 + T, 0, 3.2, [win(17, 19, 'laboratorio-norte', 'laboratorio', 0, 0, -1)]);
line('x', 22, 7.5 + T, 12.5 + T, 0, 3.2);
line('x', 28, 7.5 + T, 12.5 + T, 0, 3.2, [win(9, 11, 'laboratorio-este', 'laboratorio', 0, 0, 1, 3.5)]);
line('z', 12.5, 22 - T, 28 + T, 0, 3.2, [door(24, 26, 'puerta-5', 1250, ['laboratorio', 'patio'])]);
line('x', 30, 4.5 + T, 7.5 - T, 0, 3.2, [door(5, 7, 'puerta-3', 1000, ['laboratorio', 'energia'])]);

// ---- Sala de energía: escalera abajo y un sótano con ventanucos a ras de suelo
line('z', 4.5, 30 + T, 33 - T, -1.2, 3.2);
line('z', 7.5, 30 + T, 33 - T, -1.2, 3.2);
line('x', 33, -1 - T, 9.5 + T, -1.2, 2, [[4.5 + T, 7.5 - T]]);
walls.push([r(33 - T), 2, r(4.5 + T), r(33 + T), 3.2, r(7.5 - T)]); // sobre la escalera, el muro sube hasta el techo del pasillo
line('z', -1, 33 + T, 41 + T, -1.2, 2, [win(35, 37, 'energia-norte', 'energia', -1.2, 0, -1)]);
line('x', 41, -1 + T, 9.5 - T, -1.2, 2, [win(2, 4, 'energia-este', 'energia', -1.2, 0, 1)]);
line('z', 9.5, 33 - T, 41 + T, -1.2, 2, [door(36, 38, 'puerta-6', 1250, ['energia', 'torre'], -1.2)]);

// ---- Almacén: un paso corto y un hangar alto con estanterías
line('x', 2, 12 + T, 15 - T, 0, 3.2);
line('x', 5, 12 + T, 15 - T, 0, 3.2);
line('z', 15, -3 - T, 13 + T, 0, 4.5, [[2 + T, 5 - T]]);
walls.push([r(2), 3.2, r(15 - T), r(5), 4.5, r(15 + T)]); // sobre el paso, el muro del hangar llega a su techo
line('x', -3, 15 + T, 27 - T, 0, 4.5, [win(18, 20, 'almacen-oeste', 'almacen', 0, 0, -1), win(23, 25, 'almacen-oeste-2', 'almacen', 0, 0, -1)]);
line('z', 27, -3 - T, 13 + T, 0, 4.5, [win(4, 6, 'almacen-sur', 'almacen', 0, 0, 1)]);
line('x', 13, 15 + T, 27 - T, 0, 4.5, [door(19, 21, 'puerta-4', 1000, ['almacen', 'patio'])]);

// ---- Patio exterior: el espacio abierto entre edificios
line('z', 12.5, 13 - T, 22 - T, 0, 3.2);
line('x', 13, 12.5 - T, 15 - T, 0, 3.2);
line('x', 28, 12.5 + T, 27 + T, 0, 3.2, [[18.5 + T, 21.5 - T]]);
line('z', 27, 13 + T, 28 + T, 0, 3.2, [win(17, 19, 'patio-sur', 'patio', 0, 0, 1), win(22, 24, 'patio-sur-2', 'patio', 0, 0, 1)]);
doors.push({
  id: 'puerta-7',
  cost: 1500,
  connects: ['patio', 'torre'],
  box: [r(28 - T), 0, 19, r(28 + T), DOOR_TOP, 21],
  anchors: [[27.2, 20], [28.8, 20]],
});
walls.push([r(28 - T), 0, r(18.5 + T), r(28 + T), 3.2, 19], [r(28 - T), 0, 21, r(28 + T), 3.2, r(21.5 - T)], [r(28 - T), DOOR_TOP, 19, r(28 + T), 3.2, 21]);

// ---- Torre de radio: una loma con cerca, a la que se sube por rampa o por escalera
walls.push([31, 0, 14, 41, 1.2, 27]); // la loma (plataforma de hormigón)
line('x', 31, 14, 27, 1.2, 4.4, [[18.5, 21.5]]);
line('z', 14, 31 - T, 41 + T, 1.2, 4.4, [[36, 38]]);
line('x', 41, 14 + T, 27 - T, 1.2, 4.4, [win(17, 19, 'torre-este', 'torre', 1.2, 0, 1), win(22.5, 24.5, 'torre-este-2', 'torre', 1.2, 0, 1)]);
line('z', 27, 31 - T, 41 + T, 1.2, 4.4, [win(34, 36, 'torre-sur', 'torre', 1.2, 0, 1)]);
line('z', 18.5, 28 + T, 31, 0, 2.2); // barandillas de la rampa
line('z', 21.5, 28 + T, 31, 0, 2.2);
line('x', 36, 9.5 + T, 14, -1.2, 2.6); // paredes de la escalera
line('x', 38, 9.5 + T, 14, -1.2, 2.6);

// ---- Bloques que se rodean para mover la horda
walls.push([1.5, 0, 18, 3, 3, 24], [6, 0, 18, 7.5, 3, 24]); // estanterías del hangar
walls.push([17, 0, 18, 20.5, 2.6, 21.5]); // contenedor de carga en el Patio
walls.push([22.5, 0, 22, 26, 2, 24]); // camión de suministros
walls.push([36, -1.2, 2, 38.5, 0.6, 7]); // transformador del sótano

// ---------------------------------------------------------------- suelo de fuera, con huecos donde se baja
function minus(rect, holes) {
  let parts = [rect];
  for (const h of holes) {
    const next = [];
    for (const [x0, z0, x1, z1] of parts) {
      if (h[2] <= x0 || h[0] >= x1 || h[3] <= z0 || h[1] >= z1) {
        next.push([x0, z0, x1, z1]);
        continue;
      }
      if (h[0] > x0) next.push([x0, z0, h[0], z1]);
      if (h[2] < x1) next.push([h[2], z0, x1, z1]);
      const mx0 = Math.max(x0, h[0]);
      const mx1 = Math.min(x1, h[2]);
      if (h[1] > z0) next.push([mx0, z0, mx1, h[1]]);
      if (h[3] < z1) next.push([mx0, h[3], mx1, z1]);
    }
    parts = next;
  }
  return parts;
}
const grounds = minus([-16, -16, 56, 42], [
  [29.8, -1.2, 41.2, 9.7],
  [35.8, 9.5, 38.2, 14],
]).map(([x0, z0, x1, z1]) => [r(x0), -0.3, r(z0), r(x1), 0, r(z1)]);
// Suelo del sótano y de la escalera (por debajo de su rampa).
grounds.push([29.8, -1.5, -1.2, 41.2, -1.2, 9.7]);

// Orden fijo: las dos primeras ventanas son la norte y la oeste del Vestíbulo, y las compuertas van por número.
const first = ['vestibulo-norte', 'vestibulo-oeste'];
windows.sort((p, q) => {
  const ip = first.indexOf(p.id);
  const iq = first.indexOf(q.id);
  return (ip < 0 ? 99 : ip) - (iq < 0 ? 99 : iq);
});
doors.sort((p, q) => Number(p.id.split('-')[1]) - Number(q.id.split('-')[1]));

const map = {
  name: 'estacion-aurora-montana',
  wallHeight: 3.2,
  sillHeight: SILL,
  windowTop: WIN_TOP,
  planksPerWindow: 5,
  grounds,
  walls,
  windows,
  doors,
  zones: zones.map((z) => ({ id: z.id, startsOpen: z.startsOpen, rooms: z.rooms, lights: z.lights })),
  ramps,
  wallBuys: [
    { id: 'taquilla-smg5', weapon: 'smg5', cost: 750, anchor: [9.5, 0.9], facing: [0, 1] },
    { id: 'taquilla-m870', weapon: 'm870', cost: 500, anchor: [10.6, 11.1], facing: [0, -1] },
    { id: 'taquilla-v45', weapon: 'v45', cost: 1000, anchor: [14, 6.6], facing: [0, -1] },
    { id: 'taquilla-ak74', weapon: 'ak74', cost: 1250, anchor: [9, 15.9], facing: [0, 1] },
    { id: 'taquilla-m16', weapon: 'm16', cost: 1500, anchor: [25.6, 26.1], facing: [0, -1] },
  ],
  playerStart: { position: [6, 0, 7], yaw: 0 },
  powerSwitch: { model: 'panel-energia', anchor: [39.4, 7.3], facing: [-1, 0], box: [40.1, -1.2, 6.5, 40.8, 0.4, 8.1] },
  perkStations: [
    { perk: 'segundoAliento', model: 'suero-segundo-aliento', anchor: [6, 10.9], facing: [0, -1], box: [5.5, 0.5, 11.35, 6.5, 2, 11.8] },
    { perk: 'coraza', model: 'suero-coraza', anchor: [20.1, 1], facing: [-1, 0], box: [20.35, 0.5, 0.5, 20.8, 2, 1.5] },
    { perk: 'pulso', model: 'suero-coraza', anchor: [14.1, 24], facing: [1, 0], box: [13.2, 0.5, 23.5, 13.65, 2, 24.5] },
    { perk: 'dobleFilo', model: 'suero-segundo-aliento', anchor: [39, 0.1], facing: [0, 1], box: [38.5, -0.7, -0.8, 39.5, 0.8, -0.35] },
  ],
  forja: { model: 'forja', anchor: [38.6, 25.2], facing: [0, -1], box: [37.5, 1.2, 25.8, 39.7, 3, 26.8] },
  // El primero, en el Almacén: ahí está El Contenedor al empezar (GDD).
  contenedorSpots: [
    { model: 'contenedor', anchor: [10, 25.4], facing: [0, -1], box: [9.5, 0, 26, 10.5, 1.6, 26.8] },
    { model: 'contenedor', anchor: [16.6, 0.5], facing: [1, 0], box: [15.2, 0, 0, 16, 1.6, 1] },
    { model: 'contenedor', anchor: [26.4, 14], facing: [-1, 0], box: [27, 0, 13.5, 27.8, 1.6, 14.5] },
    { model: 'contenedor', anchor: [32.8, 25], facing: [1, 0], box: [31.2, 1.2, 24.5, 32, 2.8, 25.5] },
  ],
  radioTower: { center: [36.5, 21], half: 1.5, leg: 0.3, height: 18, base: 1.2 },
  decor: [
    // Laboratorio
    { model: 'mesa-laboratorio', facing: [1, 0], box: [22.2, 0, 8.5, 23, 1, 10.3] },
    { model: 'computadora', facing: [0, 1], box: [19.2, 0, -0.8, 20.8, 1.6, -0.1] },
    { model: 'taquillas', facing: [0, 1], box: [22, 0, 4.7, 24, 1.9, 5.2] },
    { model: 'tuberias', facing: [0, -1], box: [18, 0.6, 7.1, 20, 2.6, 7.3] },
    { model: 'bidones', facing: [-1, 0], box: [27, 0, 11.4, 27.75, 1, 12.3] },
    { model: 'armario-laboratorio', facing: [0, 1], box: [15.2, 0, -0.8, 16.2, 2, -0.25] },
    // Sala de energía
    { model: 'computadora', facing: [0, -1], box: [33.4, -1.2, 8.5, 35, 0.4, 9.2] },
    { model: 'armario-laboratorio', facing: [0, 1], box: [33.4, -1.2, -0.8, 34.4, 0.8, -0.25] },
    { model: 'tuberias', facing: [-1, 0], box: [40.6, -0.6, -0.6, 40.8, 1.4, 1.4] },
    // Almacén
    { model: 'cajas-metal', facing: [0, 1], box: [9, 0, 18, 10.05, 1, 19.05] },
    { model: 'cajas-metal', facing: [1, 0], box: [-2.2, 0, 25.2, -1.15, 1, 26.25] },
    { model: 'bidones', facing: [-1, 0], box: [11.5, 0, 16, 12.25, 1, 17.15] },
    { model: 'taquillas', facing: [1, 0], box: [-2.8, 0, 15.8, -2.3, 1.9, 17.8] },
    // Patio
    { model: 'bidones', facing: [0, -1], box: [14, 0, 13, 14.75, 1, 14.15] },
    { model: 'cajas-metal', facing: [0, 1], box: [26.5, 0, 25.5, 27.55, 1, 26.55] },
    // Torre
    { model: 'cajas-metal', facing: [0, 1], box: [39.5, 1.2, 15, 40.55, 2.2, 16.05] },
    { model: 'bidones', facing: [-1, 0], box: [32, 1.2, 15, 32.75, 2.2, 16.15] },
  ],
};
writeFileSync('shared/data/maps/prototipo.json', `${JSON.stringify(map, null, 2)}\n`);
console.log(`muros ${walls.length} · ventanas ${windows.length} · compuertas ${doors.length} · suelos ${grounds.length}`);
