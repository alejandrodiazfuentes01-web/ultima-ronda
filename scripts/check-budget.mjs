// Comprueba el build contra los presupuestos de descarga del CLAUDE.md.
// Falla (código de salida 1) si se supera algún límite; avisa al pasar del 80 %.
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const MB = 1024 * 1024;
const LIMITS = {
  initialBytes: 15 * MB, // descarga hasta poder jugar
  totalBytes: 60 * MB, // descarga total
  files: 1500, // archivos en el build
};
const WARN_AT = 0.8;

// Carpeta de assets de carga diferida. Lo que no esté aquí cuenta como descarga inicial.
const LAZY_DIR = 'lazy';

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const dist = process.argv[2] ?? 'dist';
const files = walk(dist);
let total = 0;
let initial = 0;
for (const file of files) {
  const size = statSync(file).size;
  total += size;
  if (!relative(dist, file).split(/[\\/]/).includes(LAZY_DIR)) initial += size;
}

const rows = [
  ['Descarga inicial', initial, LIMITS.initialBytes, (v) => `${(v / MB).toFixed(2)} MB`],
  ['Descarga total', total, LIMITS.totalBytes, (v) => `${(v / MB).toFixed(2)} MB`],
  ['Archivos', files.length, LIMITS.files, (v) => String(v)],
];

let failed = false;
console.log('\nPresupuesto del build:');
for (const [name, value, limit, fmt] of rows) {
  const ratio = value / limit;
  const mark = ratio > 1 ? 'SUPERADO' : ratio >= WARN_AT ? 'CERCA DEL LÍMITE' : 'ok';
  if (ratio > 1) failed = true;
  console.log(`  ${name}: ${fmt(value)} de ${fmt(limit)} (${Math.round(ratio * 100)} %) ${mark}`);
}

if (failed) {
  console.error('\nEl build supera el presupuesto. No se puede dar por terminado.');
  process.exit(1);
}
