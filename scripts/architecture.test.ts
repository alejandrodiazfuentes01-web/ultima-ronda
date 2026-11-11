import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Archivos .ts de una carpeta, sin contar las pruebas. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });
}

const root = join(import.meta.dirname, '..');

describe('reglas de arquitectura', () => {
  it('regla 1: shared/ no usa Three.js ni el navegador', () => {
    const forbidden = /from\s+['"]three|\bdocument\.|\bwindow\.|\blocalStorage\b|\bnavigator\.|\brequestAnimationFrame\b/;
    for (const file of sourceFiles(join(root, 'shared'))) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(forbidden);
    }
  });

  it('regla 4: sin sombreadores GLSL a medida en ningún sitio', () => {
    const forbidden = /\bShaderMaterial\b|\bRawShaderMaterial\b|\bonBeforeCompile\b/;
    for (const file of [...sourceFiles(join(root, 'shared')), ...sourceFiles(join(root, 'client'))]) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(forbidden);
    }
  });

  it('regla 10: ninguna dirección externa en el código del cliente', () => {
    for (const file of sourceFiles(join(root, 'client'))) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/https?:\/\//);
    }
    expect(readFileSync(join(root, 'client', 'index.html'), 'utf8')).not.toMatch(/(src|href)=["']https?:/);
  });

  it('cada modelo del mapa existe y está apuntado en docs/LICENCIAS.md', () => {
    const map = JSON.parse(readFileSync(join(root, 'shared', 'data', 'maps', 'prototipo.json'), 'utf8')) as Record<string, unknown>;
    const models = new Set<string>();
    const collect = (x: unknown): void => {
      if (Array.isArray(x)) x.forEach(collect);
      else if (x && typeof x === 'object') {
        for (const [k, v] of Object.entries(x)) {
          if (k === 'model' && typeof v === 'string') models.add(v);
          else collect(v);
        }
      }
    };
    collect(map);
    expect(models.size).toBeGreaterThan(0);
    const licences = readFileSync(join(root, 'docs', 'LICENCIAS.md'), 'utf8');
    for (const m of models) {
      expect(statSync(join(root, 'client', 'public', 'models', `${m}.glb`)).isFile(), m).toBe(true);
      expect(licences, `${m} en LICENCIAS.md`).toContain(`models/${m}.glb`);
    }
  });

  it('ningún archivo de assets queda sin apuntar en docs/LICENCIAS.md', () => {
    const licences = readFileSync(join(root, 'docs', 'LICENCIAS.md'), 'utf8');
    for (const f of readdirSync(join(root, 'client', 'public', 'models'))) expect(licences, f).toContain(`models/${f}`);
  });
});
