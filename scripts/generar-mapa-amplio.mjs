// Genera el mapa de prueba «amplio» a partir del mapa normal: el mismo trazado
// con más espacio libre en planta (x y z), y la misma altura.
//
// No escala a lo bruto: alrededor de cada línea de muro (y del bloque central)
// deja una franja sin estirar, para que lo que está pegado a la pared (estaciones,
// panel, taquillas, puntos de uso) siga pegado. El espacio entre franjas se estira.
//
// Uso:  node scripts/generar-mapa-amplio.mjs [factor=1.5]
// Lee shared/data/maps/prototipo.json y escribe shared/data/maps/amplio.json.
import { readFileSync, writeFileSync } from 'node:fs';

const FACTOR = process.argv[2] ? Number(process.argv[2]) : 1.5;
const BAND = 1.2; // metros sin estirar a cada lado de una línea de muro
const SRC = 'shared/data/maps/prototipo.json';
const DST = 'shared/data/maps/amplio.json';

const r3 = (v) => Math.round(v * 1000) / 1000;

/** Función por tramos: cada línea se mueve a línea × FACTOR; cerca de ella solo se traslada. */
function makeWarp(set) {
  const lines = [...set].sort((a, b) => a - b);
  const moved = new Map(lines.map((l) => [l, l * FACTOR]));
  return (v) => {
    const first = lines[0];
    const last = lines[lines.length - 1];
    if (v <= first) return moved.get(first) + (v - first);
    if (v >= last) return moved.get(last) + (v - last);
    for (let i = 0; i + 1 < lines.length; i++) {
      const a = lines[i];
      const b = lines[i + 1];
      if (v < a || v > b) continue;
      if (v - a <= BAND) return moved.get(a) + (v - a);
      if (b - v <= BAND) return moved.get(b) - (b - v);
      // Tramo libre: se estira para llenar el hueco nuevo.
      const t = (v - (a + BAND)) / (b - BAND - (a + BAND));
      return moved.get(a) + BAND + t * (moved.get(b) - BAND - (moved.get(a) + BAND));
    }
    throw new Error(`Fuera de rango: ${v}`);
  };
}

const m = JSON.parse(readFileSync(SRC, 'utf8'));
// Líneas de muro: centros de los muros finos y bordes del bloque central.
const xs = new Set();
const zs = new Set();
for (const [x0, , z0, x1, , z1] of m.walls) {
  if (x1 - x0 <= 0.6) xs.add(r3((x0 + x1) / 2));
  if (z1 - z0 <= 0.6) zs.add(r3((z0 + z1) / 2));
  if (x1 - x0 > 0.6 && z1 - z0 > 0.6) {
    xs.add(x0).add(x1);
    zs.add(z0).add(z1);
  }
}
const fx = makeWarp(xs);
const fz = makeWarp(zs);
const box = (b) => [r3(fx(b[0])), b[1], r3(fz(b[2])), r3(fx(b[3])), b[4], r3(fz(b[5]))];
const rect = (r) => [r3(fx(r[0])), r3(fz(r[1])), r3(fx(r[2])), r3(fz(r[3]))];
const pt = (p) => [r3(fx(p[0])), r3(fz(p[1]))];
const fix = (f) => ({ ...f, anchor: pt(f.anchor), box: box(f.box) });

const [sx, sy, sz] = m.playerStart.position;
const out = {
  ...m,
  name: `${m.name}-amplio`,
  floor: box(m.floor),
  walls: m.walls.map(box),
  windows: m.windows.map((w) => ({ ...w, opening: rect(w.opening), inside: pt(w.inside), outside: pt(w.outside), spawn: pt(w.spawn) })),
  doors: m.doors.map((d) => ({ ...d, box: box(d.box), anchors: d.anchors.map(pt) })),
  wallBuys: m.wallBuys.map((b) => ({ ...b, anchor: pt(b.anchor) })),
  playerStart: { ...m.playerStart, position: [r3(fx(sx)), sy, r3(fz(sz))] },
  navFloors: m.navFloors.map(rect),
  powerSwitch: fix(m.powerSwitch),
  perkStations: m.perkStations.map(fix),
  forja: fix(m.forja),
  contenedorSpots: m.contenedorSpots.map(fix),
  decor: m.decor.map((d) => ({ ...d, box: box(d.box) })),
  zones: m.zones.map((z) => ({ ...z, area: rect(z.area), lights: z.lights.map(pt) })),
  ...(m.radioTower ? { radioTower: { ...m.radioTower, center: pt(m.radioTower.center) } } : {}),
};
writeFileSync(DST, `${JSON.stringify(out, null, 2)}\n`);
console.log('líneas x:', [...xs].sort((a, b) => a - b), '\nlíneas z:', [...zs].sort((a, b) => a - b));
