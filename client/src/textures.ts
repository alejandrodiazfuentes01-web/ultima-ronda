/**
 * Texturas del Laboratorio, pintadas por código en un lienzo: chapa verde
 * pálido con remaches y suciedad para las paredes, baldosas gastadas para el
 * suelo. No hay archivos de imagen ni licencias de por medio.
 */
import * as THREE from 'three/webgpu';

/** Azar con semilla, para que la textura sea siempre la misma. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

function toTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Manchas de suciedad y óxido. */
function grime(g: CanvasRenderingContext2D, size: number, rand: () => number, count: number, color: string): void {
  for (let i = 0; i < count; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 4 + rand() * size * 0.08;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/** Chapa pintada: dos paneles por baldosa de textura, con juntas y remaches. Cubre 2 × 2 m. */
export function labWallTexture(): THREE.CanvasTexture {
  const size = 512;
  const [c, g] = canvas(size);
  const rand = seeded(7);
  g.fillStyle = '#9fb3a2';
  g.fillRect(0, 0, size, size);
  // Variación de la pintura.
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = `rgba(${rand() < 0.5 ? '255,255,255' : '40,50,40'},${0.03 + rand() * 0.04})`;
    g.fillRect(rand() * size, rand() * size, 2 + rand() * 6, 2 + rand() * 6);
  }
  // Franja inferior más oscura (zócalo) y chorretones.
  g.fillStyle = 'rgba(40,55,45,0.55)';
  g.fillRect(0, size * 0.78, size, size * 0.22);
  for (let i = 0; i < 18; i++) {
    const x = rand() * size;
    const h = 30 + rand() * 120;
    const y = rand() * size * 0.6;
    const grad = g.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, 'rgba(110,70,40,0.35)');
    grad.addColorStop(1, 'rgba(110,70,40,0)');
    g.fillStyle = grad;
    g.fillRect(x, y, 2 + rand() * 3, h);
  }
  grime(g, size, rand, 14, 'rgba(60,50,35,0.25)');
  // Juntas entre paneles y remaches.
  g.strokeStyle = 'rgba(30,40,32,0.8)';
  g.lineWidth = 3;
  for (const x of [0, size / 2]) {
    g.beginPath();
    g.moveTo(x + 1.5, 0);
    g.lineTo(x + 1.5, size);
    g.stroke();
  }
  g.beginPath();
  g.moveTo(0, size * 0.78);
  g.lineTo(size, size * 0.78);
  g.stroke();
  for (const x of [0, size / 2]) {
    for (let y = 12; y < size; y += 42) {
      for (const dx of [10, size / 2 - 10]) {
        g.fillStyle = 'rgba(60,70,60,0.9)';
        g.beginPath();
        g.arc(x + dx, y, 3.2, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(220,230,220,0.5)';
        g.beginPath();
        g.arc(x + dx - 1, y - 1, 1.2, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  return toTexture(c);
}

/** Baldosas gastadas, blancas y grises. Cubre 2 × 2 m (4 × 4 baldosas). */
export function labFloorTexture(): THREE.CanvasTexture {
  const size = 512;
  const [c, g] = canvas(size);
  const rand = seeded(11);
  const n = 4;
  const tile = size / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const light = (i + j) % 2 === 0;
      const v = (light ? 178 : 118) + Math.floor(rand() * 16);
      g.fillStyle = `rgb(${v},${v + 2},${v - 4})`;
      g.fillRect(i * tile, j * tile, tile, tile);
      // Grietas ocasionales.
      if (rand() < 0.3) {
        g.strokeStyle = 'rgba(40,40,40,0.45)';
        g.lineWidth = 1.2;
        g.beginPath();
        let x = i * tile + rand() * tile;
        let y = j * tile + rand() * tile;
        g.moveTo(x, y);
        for (let k = 0; k < 4; k++) {
          x += (rand() - 0.5) * 40;
          y += (rand() - 0.5) * 40;
          g.lineTo(x, y);
        }
        g.stroke();
      }
    }
  }
  g.strokeStyle = 'rgba(50,50,45,0.9)';
  g.lineWidth = 3;
  for (let k = 0; k <= n; k++) {
    g.beginPath();
    g.moveTo(k * tile, 0);
    g.lineTo(k * tile, size);
    g.stroke();
    g.beginPath();
    g.moveTo(0, k * tile);
    g.lineTo(size, k * tile);
    g.stroke();
  }
  grime(g, size, rand, 22, 'rgba(50,45,35,0.3)');
  return toTexture(c);
}
