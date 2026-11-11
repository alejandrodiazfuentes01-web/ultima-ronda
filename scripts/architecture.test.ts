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
});
